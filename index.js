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

// ==== BASE DE DATOS ====
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

// ==== IA ====
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// ==== MENÚ ====
function mainMenu() {
  return `
🖥️ *MPC JSALA - Menú Principal*

1️⃣ Reparación de computadoras  
2️⃣ Mantenimiento de computadoras  
3️⃣ Otros servicios  
4️⃣ Agendar cita  
5️⃣ Precios y productos  

Escriba *MENU* para volver aquí.
`;
}

function pricesText(prices, inventory) {
  let t = '💲 *Precios principales*\n\n';
  t += `• Reparación (mínima): ₡${prices.reparacion_minima}\n`;
  t += `• Formateo e instalación: ₡${prices.formateo}\n`;
  t += `• Mantenimiento completo: ₡${prices.limpieza}\n`;
  t += `• Cambio pasta térmica: ₡${prices.pasta_termica}\n\n`;
  t += '📦 *Productos disponibles:*\n';
  for (const item of Object.values(inventory)) {
    t += `- ${item.name}: ₡${item.price} (stock: ${item.stock})\n`;
  }
  return t;
}

// ==== RESPUESTA ====
function reply(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
}

// ==== WEBHOOK PRINCIPAL ====
app.post('/whatsapp', async (req, res) => {
  const from = req.body.From;
  const raw = req.body.Body.trim();
  const msg = raw.toLowerCase();

  await db.read();
  const sessions = db.data.sessions;

  if (!sessions[from]) {
    sessions[from] = { step: 'menu', data: {} };
    await db.write();
    return reply(res, mainMenu());
  }

  const session = sessions[from];

  if (msg === 'menu') {
    session.step = 'menu';
    session.data = {};
    await db.write();
    return reply(res, mainMenu());
  }

  // ==== MENÚ ====
  if (session.step === 'menu') {
    switch (msg) {
      case '1':
        session.step = 'rep_problema';
        await db.write();
        return reply(res, '🔧 Describe el problema que presenta tu computadora.');

      case '2':
        session.step = 'mant_opcion';
        await db.write();
        return reply(res, '🧹 ¿Deseas *precio* o *agendar* mantenimiento?');

      case '3':
        session.step = 'otros';
        await db.write();
        return reply(res, '✍️ Escríbenos qué necesitas exactamente.');

      case '4':
        session.step = 'cita_nombre';
        await db.write();
        return reply(res, '📅 Para agendar tu cita, dime tu *nombre completo*.');

      case '5':
        return reply(res, pricesText(db.data.prices, db.data.inventory));

      default:
        return reply(res, mainMenu());
    }
  }

  // ==== REPARACIÓN ====
  if (session.step === 'rep_problema') {
    session.data.problem = raw;
    session.step = 'rep_nombre';
    await db.write();
    return reply(res, '👤 Indícame tu *nombre completo*, por favor.');
  }

  if (session.step === 'rep_nombre') {
    session.data.name = raw;
    session.step = 'rep_ubicacion';
    await db.write();
    return reply(res, '📍 ¿En qué zona se encuentra o traerás el equipo?');
  }

  if (session.step === 'rep_ubicacion') {
    session.data.location = raw;

    let base = db.data.prices.reparacion_minima;
    if (raw.includes('no enciende') || session.data.problem.toLowerCase().includes('pantalla')) base += 15000;
    if (session.data.problem.toLowerCase().includes('virus')) base += 8000;

    session.step = 'menu';
    await db.write();

    return reply(res, `💰 *Estimado preliminar*: ₡${base}\n\n¿Deseas que agendemos revisión técnica?\nEscribe *AGENDAR* o *MENU*.`);
  }

  // ==== MANTENIMIENTO ====
  if (session.step === 'mant_opcion') {
    if (msg.includes('agendar')) {
      session.step = 'cita_nombre';
      await db.write();
      return reply(res, '📅 Perfecto, dime tu *nombre completo*.');
    }
    if (msg.includes('precio')) {
      return reply(res, pricesText(db.data.prices, db.data.inventory));
    }
    return reply(res, 'Responde *precio* o *agendar*');
  }

  // ==== OTROS ====
  if (session.step === 'otros') {
    session.step = 'menu';
    await db.write();
    return reply(res, '✅ Solicitud recibida. Un técnico te contactará.\n\n' + mainMenu());
  }

  // ==== CITAS ====
  if (session.step === 'cita_nombre') {
    session.data.name = raw;
    session.step = 'cita_telefono';
    await db.write();
    return reply(res, '📞 ¿Número de contacto? (o escribe *mismo*)');
  }

  if (session.step === 'cita_telefono') {
    session.data.phone = msg === 'mismo' ? from.replace('whatsapp:', '') : raw;
    session.step = 'cita_fecha';
    await db.write();
    return reply(res, '📆 Fecha deseada de la cita (ejemplo: lunes o 2025-12-05)');
  }

  if (session.step === 'cita_fecha') {
    session.data.date = raw;
    session.step = 'cita_hora';
    await db.write();
    return reply(res, '⏰ Hora aproximada (ej: 10AM o 3PM)');
  }

  if (session.step === 'cita_hora') {
    const cita = {
      id: nanoid(6),
      createdAt: new Date().toISOString(),
      from,
      ...session.data
    };

    db.data.appointments.push(cita);
    session.step = 'menu';
    session.data = {};
    await db.write();

    return reply(res, `✅ *CITA AGENDADA*\nID: ${cita.id}\nNombre: ${cita.name}\nTel: ${cita.phone}\nFecha: ${cita.date}\nHora: ${cita.time || raw}\n\nPronto te confirmamos.\n\n${mainMenu()}`);
  }

  // ==== IA ====
  if (msg.startsWith('ai ')) {
    if (!openai) return reply(res, '🤖 IA no configurada.');
    const prompt = raw.slice(3);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Asistente técnico de MPC Jsala, responde en español y breve.' },
        { role: 'user', content: prompt }
      ]
    });

    return reply(res, completion.choices[0].message.content);
  }

  // ==== FALLBACK IA ====
  if (openai) {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Soporte técnico computacional.' },
        { role: 'user', content: raw }
      ]
    });

    return reply(res, completion.choices[0].message.content + '\n\nEscribe MENU para volver.');
  }

  return reply(res, mainMenu());
});

// ==== ADMIN CITAS ====
app.get('/admin/citas', async (req, res) => {
  const token = req.query.token;
  if (token !== process.env.ADMIN_TOKEN) return res.status(403).json({ error: 'Prohibido' });

  await db.read();
  res.json(db.data.appointments);
});

// ==== INICIAR ====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ MPC JSALA BOT ACTIVADO EN PUERTO ' + PORT));
