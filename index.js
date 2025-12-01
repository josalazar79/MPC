const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { nanoid } = require('nanoid');
const fs = require('fs-extra');
const { OpenAI } = require('openai');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ==== DB SIMPLE ====
const DB_FILE = 'db.json';

async function loadDB() {
  if (!(await fs.pathExists(DB_FILE))) {
    await fs.writeJSON(DB_FILE, {
      sessions: {},
      appointments: [],
      prices: { reparacion_minima: 12000, mantenimiento: 15000 }
    }, { spaces: 2 });
  }
  return fs.readJSON(DB_FILE);
}

async function saveDB(db) {
  await fs.writeJSON(DB_FILE, db, { spaces: 2 });
}

// ==== IA OPCIONAL ====
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ==== MENÚ ====
function menu() {
  return `
🖥️ *MPC JSALA*

1️⃣ Reparación de computadoras
2️⃣ Mantenimiento de computadora
3️⃣ Otros servicios
4️⃣ Agendar cita
5️⃣ Precios

Escribe MENU para volver.
`;
}

function precios(p) {
  return `
💰 *PRECIOS*
🔧 Reparación mínima: ₡${p.reparacion_minima}
🧼 Mantenimiento: ₡${p.mantenimiento}
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

  // NUEVO USUARIO
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

  // MENU
  if (session.step === 'menu') {
    switch (msg) {
      case '1':
        session.step = 'rep_problema';
        await saveDB(db);
        return responder(res, '🔧 Describe el problema de tu computadora:');

      case '2':
        session.step = 'mant_opcion';
        await saveDB(db);
        return responder(res, '🧼 Escribe PRECIO o AGENDAR');

      case '3':
        session.step = 'otros';
        await saveDB(db);
        return responder(res, '✍️ Describe tu solicitud:');

      case '4':
        session.step = 'cita_nombre';
        await saveDB(db);
        return responder(res, '👤 Tu nombre completo para la cita:');

      case '5':
        return responder(res, precios(db.prices));

      default:
        return responder(res, menu());
    }
  }

  // REPARACIÓN
  if (session.step === 'rep_problema') {
    session.data.problema = raw;
    session.step = 'rep_nombre';
    await saveDB(db);
    return responder(res, '👤 Tu nombre:');
  }

  if (session.step === 'rep_nombre') {
    session.step = 'menu';
    await saveDB(db);
    return responder(res,
      `✅ Solicitud registrada\n\nNombre: ${raw}\nProblema: ${session.data.problema}\n\n${menu()}`
    );
  }

  // MANTENIMIENTO
  if (session.step === 'mant_opcion') {
    if (msg.includes('precio')) return responder(res, precios(db.prices));
    if (msg.includes('agendar')) {
      session.step = 'cita_nombre';
      await saveDB(db);
      return responder(res, '👤 Nombre del cliente:');
    }
    return responder(res, 'Escribe PRECIO o AGENDAR');
  }

  // OTROS
  if (session.step === 'otros') {
    session.step = 'menu';
    await saveDB(db);
    return responder(res, '✅ Mensaje recibido. Te contactaremos.\n\n' + menu());
  }

  // CITAS
  if (session.step === 'cita_nombre') {
    session.data.nombre = raw;
    session.step = 'cita_fecha';
    await saveDB(db);
    return responder(res, '📅 Fecha deseada:');
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
      hora: raw
    };
    db.appointments.push(cita);
    session.step = 'menu';
    session.data = {};
    await saveDB(db);

    return responder(res,
      `✅ CITA CONFIRMADA\nID: ${cita.id}\n${cita.nombre}\n${cita.fecha} ${cita.hora}\n\n${menu()}`
    );
  }

  return responder(res, menu());
});

// SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ MPC JSALA BOT ACTIVO EN PUERTO ${PORT}`));
