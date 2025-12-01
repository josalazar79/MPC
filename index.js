// index.js
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const MessagingResponse = twilio.twiml.MessagingResponse;
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Memoria simple de sesiones (para producción idealmente usar Redis, DB, etc.)
const sessions = {};
const OPERATOR_WHATSAPP = process.env.OPERATOR_WHATSAPP || 'whatsapp:+50688998177';

function getSession(from) {
  if (!sessions[from]) {
    sessions[from] = {
      state: 'WELCOME',
      flow: null,
      personal: {},
      technical: {},
      extra: {}
    };
  }
  return sessions[from];
}

function resetSession(from) {
  delete sessions[from];
}

// Utilidad: limpiar texto
function cleanText(t) {
  return (t || '').trim();
}

// Detectar si podría ser remoto (muy simple, basado en palabras clave)
function isRemoteCandidate(description) {
  const txt = (description || '').toLowerCase();
  const keywords = ['licencia', 'office', 'antivirus', 'formato', 'instalar programa', 'software', 'activación'];
  return keywords.some(k => txt.includes(k));
}

// Construir mensaje interno para el operador
function buildInternalMessage(from, session) {
  const p = session.personal || {};
  const t = session.technical || {};
  const e = session.extra || {};

  return [
    '[MPC JSALA – Nuevo caso WhatsApp]',
    '',
    `📱 Cliente: ${p.nombre || 'N/D'}`,
    `☎️ Teléfono: ${p.telefono || from}`,
    `📍 Zona: ${p.zona || 'N/D'}`,
    `📧 Email: ${p.email || 'N/D'}`,
    `🕐 Horario preferido: ${p.horario || 'N/D'}`,
    '',
    `📂 Tipo de flujo: ${session.flow || 'N/D'}`,
    `💻 Equipo: ${t.equipo || 'N/D'} – ${t.so || 'N/D'}`,
    `📝 Descripción problema: ${t.descripcion || e.consulta || 'N/D'}`,
    `⚙️ Enciende: ${t.enciende || 'N/D'}`,
    `🖥️ Pantalla / errores: ${t.pantalla || 'N/D'}`,
    `⏳ Evolución del problema: ${t.evolucion || 'N/D'}`,
    `🔧 Revisado antes: ${t.revisado || 'N/D'}`,
    `📆 Urgencia: ${t.urgencia || 'N/D'}`,
    '',
    `📅 Preferencia de cita: ${e.preferenciaCita || 'N/D'}`,
    `🔍 Estado servicio (nombre/orden/fecha): ${e.estadoServicio || 'N/D'}`,
    '',
    `🔁 Recomendación bot: ${e.recomendacion || 'N/D'}`
  ].join('\n');
}

// Enviar mensaje interno al operador
async function sendInternalMessage(body) {
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: OPERATOR_WHATSAPP,
      body
    });
  } catch (err) {
    console.error('Error enviando mensaje interno:', err.message);
  }
}

// Webhook principal de WhatsApp
app.post('/whatsapp', async (req, res) => {
  const twiml = new MessagingResponse();
  const incomingMsg = cleanText(req.body.Body);
  const from = req.body.From;

  const session = getSession(from);

  // Si el usuario escribe "menu" o "reiniciar"
  if (/^menu$/i.test(incomingMsg) || /^reiniciar$/i.test(incomingMsg)) {
    resetSession(from);
    const twiml2 = new MessagingResponse();
    twiml2.message(
      '👋 Hola, soy el asistente virtual de *MPC JSALA*.\n' +
      'Te ayudo con mantenimiento y reparación de computadoras portátiles.\n\n' +
      '🕐 Horario de atención con cita:\n' +
      '• L–V: 4:00 p.m. – 9:00 p.m.\n' +
      '• Sábado: 9:00 a.m. – 9:00 p.m.\n\n' +
      'Elige una opción respondiendo con el número:\n' +
      '1️⃣ Mantenimiento / limpieza de computadora\n' +
      '2️⃣ Consulta técnica rápida\n' +
      '3️⃣ Agendar cita en taller\n' +
      '4️⃣ Estado de un servicio en curso\n' +
      '5️⃣ Hablar con un asesor'
    );
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(twiml2.toString());
  }

  // Máquina de estados
  switch (session.state) {
    case 'WELCOME': {
      // Mostrar menú de bienvenida
      session.state = 'MAIN_MENU';
      twiml.message(
        '👋 Hola, soy el asistente virtual de *MPC JSALA*.\n' +
        'Te ayudo con *mantenimiento y reparación de computadoras portátiles*, soporte remoto y citas en taller.\n\n' +
        '🕐 Horario de atención con cita:\n' +
        '• L–V: 4:00 p.m. – 9:00 p.m.\n' +
        '• Sábado: 9:00 a.m. – 9:00 p.m.\n\n' +
        'Por favor elige una opción respondiendo con el número:\n' +
        '1️⃣ Mantenimiento / limpieza de computadora\n' +
        '2️⃣ Consulta técnica rápida\n' +
        '3️⃣ Agendar cita en taller\n' +
        '4️⃣ Estado de un servicio en curso\n' +
        '5️⃣ Hablar con un asesor'
      );
      break;
    }

    case 'MAIN_MENU': {
      if (!['1','2','3','4','5'].includes(incomingMsg)) {
        twiml.message(
          'Por favor elige una opción válida:\n' +
          '1️⃣ Mantenimiento / limpieza de computadora\n' +
          '2️⃣ Consulta técnica rápida\n' +
          '3️⃣ Agendar cita en taller\n' +
          '4️⃣ Estado de un servicio en curso\n' +
          '5️⃣ Hablar con un asesor'
        );
        break;
      }

      if (incomingMsg === '1') {
        session.flow = 'Mantenimiento y limpieza';
        session.state = 'PERS_NAME';
        twiml.message(
          'Perfecto, te ayudo con *mantenimiento y limpieza de tu computadora portátil*.\n' +
          'Primero, tomemos algunos datos tuyos.\n\n' +
          '👉 ¿Cuál es tu *nombre completo*?'
        );
      } else if (incomingMsg === '2') {
        session.flow = 'Consulta técnica rápida';
        session.state = 'PERS_NAME';
        twiml.message(
          'Genial, veamos tu *consulta técnica rápida*.\n' +
          'Primero, ¿cuál es tu *nombre completo*?'
        );
      } else if (incomingMsg === '3') {
        session.flow = 'Agendar cita en taller';
        session.state = 'PERS_NAME';
        twiml.message(
          'Perfecto, agendemos una *cita en taller*.\n' +
          'Para empezar, ¿cuál es tu *nombre completo*?'
