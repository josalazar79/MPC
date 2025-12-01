require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const { nanoid } = require('nanoid');
const { OpenAI } = require('openai');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ===== BASE DE DATOS =====
const adapter = new JSONFile('db.json');
const db = new Low(adapter);

async function initDB() {
  await db.read();
  db.data ||= {
    sessions: {},
    appointments: [],
    inventory: {
      'ssd-256': { name: 'SSD 256GB', price: 35000, stock: 5 },
      'ram-8gb': { name: 'RAM 8GB DDR4', price: 20000, stock: 8 }
    },
    prices: {
      reparacion_minima: 12000,
      formateo: 20000,
      limpieza: 15000,
      pasta_termica: 8000
    }
  };
  await db.write();
}
initDB();

// ===== IA =====
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// ===== MENÚ =====
function menuPrincipal() {
  return `
🖥️ *MPC JSALA - Soporte Técnico*

1️⃣ Reparación de computadoras
2️⃣ Mantenimiento de computadoras
3️⃣ Otros servicios
4️⃣ Agendar cita
5️⃣ Ver precios y productos

Escriba *MENU* para volver aquí.
`;
}

function preciosTexto(prices, inventory) {
  let t = '💰 *PRECIOS DISPONIBLES*\n\n';
  t += `🔧 Reparación mínima: ₡${prices.reparacion_minima}\n`;
  t += `🧼 Mantenimiento completo: ₡${prices.limpieza}\n`;
  t += `💿 Formateo e instalación: ₡${prices.formateo}\n`;
  t += `🌡️ Cambio pasta térmica: ₡${prices.pasta_termica}\n\n`;
  t += '📦 *Productos disponibles:*\n';
  for (const item of Object.values(inventory)) {
    t += `• ${item.name} — ₡${item.price} (stock: ${item.stock})\n`;
  }
  return t;
}

// ===== RESPUESTAS =====
function responder(res, texto) {
  const twiml = new MessagingResponse();
  twiml.message(texto);
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
}

// ===== WHATSAPP WEBHOOK =====
app.post('/whatsapp', async (req, res) => {
  const from = req.body.From;
  const raw = req.body.Body.trim();
  const msg = raw.toLowerCase();

  await db.read();
  const sessions = db.data.sessions;

  if (!sessions[from]) {
    sessions[from] = { step: 'menu', data: {} };
    await db.write();
    return responder(res, menuPrincipal());
  }

  const session = sessions[from];

  if (msg === 'menu') {
    session.step = 'menu';
    session.data = {};
    await db.write();
    return responder(res, menuPrincipal());
  }

  // ===== MENÚ =====
  if (session.step === 'menu') {
    switch (msg) {
      case '1':
        session.step = 'rep_problema';
        await db.write();
        return responder(res, '🔧 Describe el problema que presenta tu computadora.');

      case '2':
        session.step = 'mant_opcion';
        await db.write();
        return responder(res, '🧼 ¿Deseas *precio* o *agendar* mantenimiento?');

      case '3':
        session.step = 'otros';
        await db.write();
        return responder(res, '✍️ Escríbenos qué necesitas exactamente.');

      case '4':
        session.step = 'cita_nombre';
        await db.write();
        return responder(res, '📅 Indica tu nombre completo para la cita.');

      case '5':
        return responder(res, preciosTexto(db.data.prices, db.data.inventory));

      default:
        return responder(res, menuPrincipal());
    }
  }

  // ===== REPARACIÓN =====
  if (session.step === 'rep_problema') {
    session.data.problema = raw;
    session.step = 'rep_nombre';
    await db.write();
    return responder(res, '👤 Indícame tu nombre completo.');
  }

  if (session.step === 'rep_nombre') {
    session.data.nombre = raw;
    session.step = 'rep_ubicacion';
    await db.write();
    return responder(res, '📍 ¿En qué zona te encuentras o traerás el equipo?');
  }

  if (session.step === 'rep_ubicacion') {
    session.data.ubicacion = raw;

    let estimado = db.data.prices.reparacion_minima;
    if (session.data.problema.toLowerCase().includes('pantalla')) estimado += 15000;
    if (session.data.problema.toLowerCase().includes('virus')) estimado += 8000;

    session.step = 'menu';
    await db.write();

    return responder(res, `💰 Estimado preliminar: ₡${estimado}\n\n¿Deseas agendar revisión?\nEscribe *AGENDAR* o *MENU*.`);
  }

  // ===== MANTENIMIENTO =====
  if (session.step === 'mant_opcion') {
    if (msg.includes('agendar')) {
      session.step = 'cita_nombre';
      await db.write();
      return responder(res, '📅 Dime tu nombre completo.');
    }
    if (msg.includes('precio')) {
      return responder(res, preciosTexto(db.data.prices, db.data.inventory));
    }
    return responder(res, 'Responde con *precio* o *agendar*');
  }

  // ===== OTROS =====
  if (session.step === 'otros') {
    session.step = 'menu';
    await db.write();
    return responder(res, '✅ Mensaje recibido, un técnico te contactará.\n\n' + menuPrincipal());
  }

  // ===== CITAS =====
  if (session.step === 'cita_nombre') {
    session.data.nombre = raw;
    session.step = 'cita_telefono';
    await db.write();
    return responder(res, '📞 ¿Número de contacto? (o escribe *mismo*)');
  }

  if (session.step === 'cita_telefono') {
    session.data.telefono = msg === 'mismo' ? from.replace('whatsapp:', '') : raw;
    session.step = 'cita_fecha';
    await db.write();
    return responder(res, '📅 Fecha preferida (ej: lunes o 2025-12-05)');
  }

  if (session.step === 'cita_fecha') {
    session.data.fecha = raw;
    session.step = 'cita_hora';
    await db.write();
    return responder(res, '⏰ Hora estimada (ej: 10AM o 3PM)');
  }

  if (session.step === 'cita_hora') {
    const cita = {
      id: nanoid(6),
      createdAt: new Date().toISOString(),
      from,
      ...session.data,
      hora: raw
    };

    db.data.appointments.push(cita);
    session.step = 'menu';
    session.data = {};
    await db.write();

    return responder(res, `✅ *CITA AGENDADA*\nID: ${cita.id}
Nombre: ${cita.nombre}
Tel: ${cita.telefono}
Fecha: ${cita.fecha}
Hora: ${cita.hora}

📞 Te contactaremos pronto.

${menuPrincipal()}`);
  }

  // ===== IA =====
  if (msg.startsWith('ai ')) {
    if (!openai) return responder(res, '🚫 IA no configurada.');
    const pregunta = raw.slice(3);

    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Asistente técnico MPC Jsala, responde claro y corto.' },
        { role: 'user', content: pregunta }
      ]
    });

    return responder(res, result.choices[0].message.content);
  }

  // ===== FALLBACK =====
  if (openai) {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Soporte técnico computadoras.' },
        { role: 'user', content: raw }
      ]
    });

    return responder(res, result.choices[0].message.content + '\n\nEscribe MENU para volver.');
  }

  return responder(res, menuPrincipal());
});

// ===== ADMIN CITAS =====
app.get('/admin/citas', async (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) return res.sendStatus(403);
  await db.read();
  res.json(db.data.appointments);
});

// ===== SERVIDOR =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ MPC JSALA BOT EJECUTANDO EN PUERTO ${PORT}`));
