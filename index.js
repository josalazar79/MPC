const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { nanoid } = require('nanoid');
const fs = require('fs-extra');
const { OpenAI } = require('openai');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ==== ARCHIVOS ====
const DB_FILE = 'db.json';

// ==== INICIALIZAR BD ====
async function loadDB() {
  if (!(await fs.pathExists(DB_FILE))) {
    const data = {
      sessions: {},
      appointments: [],
      prices: {
        reparacion_minima: 12000,
        mantenimiento: 15000
      }
    };
    await fs.writeJSON(DB_FILE, data, { spaces: 2 });
  }
  return await fs.readJSON(DB_FILE);
}

async function saveDB(data) {
  await fs.writeJSON(DB_FILE, data, { spaces: 2 });
}

// ==== IA ====
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ==== MENÚ ====
function menu() {
  return `
🖥️ *MPC JSALA*
Mantenimiento de computadoras

1️⃣ Reparación
2️⃣ Mantenimiento
3️⃣ Otros servicios
4️⃣ Cita técnica
5️⃣ Precios

Escribe MENU para volver.
`;
}

function precios(prices) {
  return `
💰 *PRECIOS*
🔧 Reparación mínima: ₡${prices.reparacion_minima}
🧼 Mantenimiento: ₡${prices.mantenimiento}
`;
}

function responder(res, texto) {
  const twiml = new MessagingResponse();
  twiml.message(texto);
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
}

// ==== WEBHOOK ====
app.post('/whatsapp', async (req, res) => {
  const from = req.body.From;
  const raw = req.body.Body.trim();
  const msg = raw.toLowerCase();

  const db = await loadDB();

  if (!db.sessions[from]) {
    db.sessions[from] = { step: 'menu', data: {} };
    await saveDB(db);
    return responder(res, menu());
  }

  const session = db.sessions[from];

  if (msg === 'menu') {
    session.step = 'menu';
    session.data = {};
    await saveDB(db);
    return responder(res, menu());
  }

  // ==== MENU ====
  if (session.step === 'menu') {
    switch (msg) {
      case '1':
        session.step = 'rep_problema';
        await saveDB(db);
        return responder(res, '🔧 Describe el problema de tu computadora:');

      case '2':
        session.step = 'mantenimiento';
        await saveDB(db);
        return responder(res, '🧼 ¿Deseas PRECIO o AGENDAR?');

      case '3':
        session.step = 'otros';
        await saveDB(db);
        return responder(res, '✍️ Describe tu solicitud:');

      case '4':
        session.step = 'cita_nombre';
        await saveDB(db);
        return responder(res, '👤 Tu nombre completo por favor:');

      case '5':
        return responder(res, precios(db.prices));

      default:
        return responder(res, menu());
    }
  }

  // ==== REPARACIÓN ====
  if (session.step === 'rep_problema') {
    session.data.problema = raw;
    session.step = 'rep_nombre';
    await saveDB(db);
    return responder(res, '👤 Tu nombre:');
  }

  if (session.step === 'rep_nombre') {
    session.data.nombre = raw;
    session.step = 'menu';
    await saveDB(db);
    return responder(res, `✅ Caso registrado\n\nNombre: ${session.data.nombre}\nProblema: ${session.data.problema}\n\n${menu()}`);
  }

  // ==== MANTENIMIENTO ====
  if (session.step === 'mantenimiento') {
    if (msg.includes('precio')) return responder(res, precios(db.prices));
    if (msg.includes('agendar')) {
      session.step = 'cita_nombre';
      await saveDB(db);
      return responder(res, '👤 Tu nombre para la cita:');
    }
    return responder(res, 'Escribe PRECIO o AGENDAR');
  }

  // ==== OTROS ====
  if (session.step === 'otros') {
    session.step = 'menu';
    await saveDB(db);
    return responder(res, '✅ Mensaje recibido. Te contactaremos pronto.\n\n' + menu());
  }

  // ==== CITAS ====
  if (session.step === 'cita_nombre') {
    session.data.nombre = raw;
    session.step = 'cita_fecha';
    await saveDB(db);
    return responder(res, '📆 Fecha deseada:');
  }

  if (session.step === 'cita_fecha') {
    session.data.fecha = raw;
    session.step = 'cita_hora';
    await saveDB(db);
    return responder(res, '⏰ Hora aproximada:');
  }

  if (session.step === 'cita_hora') {
    const cita = {
      id: nanoid(6),
      nombre: session.data.nombre,
      fecha: session.data.fecha,
      hora: raw,
      creado: new Date()
    };

    db.appointments.push(cita);
    session.step = 'menu';
    session.data = {};
    await saveDB(db);

    return responder(res, `✅ CITA AGENDADA\nID: ${cita.id}\nCliente: ${cita.nombre}\nFecha: ${cita.fecha} ${cita.hora}\n\n${menu()}`);
  }

  return responder(res, menu());
});

// ==== INICIAR ====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ BOT CORRIENDO EN PUERTO ${PORT}`));
