// index.js
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const MessagingResponse = twilio.twiml.MessagingResponse;
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Memoria simple en RAM (para producción ideal: Redis / BD)
const sessions = {};

// Número de WhatsApp del operador (para recibir los datos del cliente)
const OPERATOR_WHATSAPP = process.env.OPERATOR_WHATSAPP || 'whatsapp:+50688998177';

// Texto del menú principal
const mainMenuText =
  '👋 Hola, soy el asistente virtual de *MPC JSALA*.\n' +
  'Te ayudo con *mantenimiento y reparación de computadoras portátiles*, soporte remoto y citas en taller.\n\n' +
  '🕐 *Horario de atención con cita:*\n' +
  '• L–V: 4:00 p.m. – 9:00 p.m.\n' +
  '• Sábado: 9:00 a.m. – 9:00 p.m.\n\n' +
  '📋 *Menú principal MPC JSALA*\n' +
  'Responde solo con el número de la opción:\n\n' +
  '1️⃣ Mantenimiento / limpieza de computadora\n' +
  '2️⃣ Consulta técnica rápida\n' +
  '3️⃣ Agendar cita en taller\n' +
  '4️⃣ Estado de un servicio en curso\n' +
  '5️⃣ Hablar con un asesor\n\n' +
  '✳️ En cualquier momento puedes escribir *menu* para volver aquí.';

// ---------- Funciones de utilidad ----------

// Crea o devuelve la sesión de un número
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

// Borra la sesión de un número
function resetSession(from) {
  delete sessions[from];
}

// Limpia texto de entrada
function cleanText(t) {
  return (t || '').trim();
}

// Lógica simple para saber si podría ser soporte remoto
function isRemoteCandidate(description) {
  const txt = (description || '').toLowerCase();
  const keywords = [
    'licencia',
    'office',
    'antivirus',
    'formato',
    'instalar programa',
    'software',
    'activación',
    'activar office',
    'activar windows'
  ];
  return keywords.some(k => txt.includes(k));
}

// Construye el mensaje interno para el operador
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
    `🛠 Último mantenimiento: ${e.ultimoMantenimiento || 'N/D'}`,
    `🔥 Síntomas de calentamiento/ruido: ${e.sintomasMantenimiento || 'N/D'}`,
    '',
    `🔁 Recomendación bot: ${e.recomendacion || 'N/D'}`
  ].join('\n');
}

// Enviar mensaje interno al operador
async function sendInternalMessage(body) {
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM, // sandbox o número productivo
      to: OPERATOR_WHATSAPP,                  // tu número: whatsapp:+50688998177
      body
    });
  } catch (err) {
    console.error('Error enviando mensaje interno:', err.message);
  }
}

// ---------- Webhook principal de WhatsApp ----------

app.post('/whatsapp', async (req, res) => {
  const twiml = new MessagingResponse();
  const incomingMsg = cleanText(req.body.Body);
  const from = req.body.From;

  let session = getSession(from);

  // Comando global para volver al menú
  if (/^menu$/i.test(incomingMsg) || /^reiniciar$/i.test(incomingMsg)) {
    resetSession(from);
    session = getSession(from);
    session.state = 'MAIN_MENU';

    twiml.message(mainMenuText);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(twiml.toString());
  }

  // Máquina de estados principal
  switch (session.state) {
    // Primera vez que escribe el cliente
    case 'WELCOME': {
      session.state = 'MAIN_MENU';
      twiml.message(mainMenuText);
      break;
    }

    // Menú principal
    case 'MAIN_MENU': {
      if (!['1', '2', '3', '4', '5'].includes(incomingMsg)) {
        twiml.message(
          'Por favor elige una opción válida respondiendo solo con el número:\n\n' +
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
          'Genial, veamos tu *consulta técnica rápida*.\n\n' +
          '👉 ¿Cuál es tu *nombre completo*?'
        );
      } else if (incomingMsg === '3') {
        session.flow = 'Agendar cita en taller';
        session.state = 'PERS_NAME';
        twiml.message(
          'Perfecto, agendemos una *cita en taller*.\n\n' +
          '👉 ¿Cuál es tu *nombre completo*?'
        );
      } else if (incomingMsg === '4') {
        session.flow = 'Estado de servicio en curso';
        session.state = 'STATUS_DATA';
        twiml.message(
          'Te ayudo a consultar el *estado de un servicio en curso*.\n\n' +
          '👉 ¿A nombre de quién está el servicio? (nombre completo)'
        );
      } else if (incomingMsg === '5') {
        session.flow = 'Hablar con asesor';
        session.state = 'PERS_NAME';
        twiml.message(
          'Está bien, te conectamos con un *asesor humano*.\n\n' +
          '👉 ¿Cuál es tu *nombre completo*?'
        );
      }
      break;
    }

    // ---------- Recolector de datos personales ----------
    case 'PERS_NAME': {
      session.personal.nombre = incomingMsg;
      session.state = 'PERS_PHONE';
      twiml.message(
        `Gracias, ${incomingMsg}.\n` +
        '👉 ¿Cuál es tu *número de teléfono de contacto*? (Si es este mismo, responde "mismo")'
      );
      break;
    }
    case 'PERS_PHONE': {
      if (/mismo/i.test(incomingMsg)) {
        session.personal.telefono = from;
      } else {
        session.personal.telefono = incomingMsg;
      }
      session.state = 'PERS_ZONE';
      twiml.message(
        'Gracias.\n' +
        '👉 ¿En qué *distrito o zona* te encuentras?\n' +
        '(Ej: Río Claro Centro, Golfito, Ciudad Neily, Paso Canoas u otra zona cercana)'
      );
      break;
    }
    case 'PERS_ZONE': {
      session.personal.zona = incomingMsg;
      session.state = 'PERS_EMAIL';
      twiml.message(
        'Perfecto.\n' +
        '👉 ¿Tienes un *correo electrónico* para enviarte información de tu servicio? (opcional, puedes responder "no")'
      );
      break;
    }
    case 'PERS_EMAIL': {
      if (/^no$/i.test(incomingMsg)) {
        session.personal.email = 'No indica';
      } else {
        session.personal.email = incomingMsg;
      }
      session.state = 'PERS_SCHEDULE';
      twiml.message(
        'Perfecto.\n' +
        '👉 ¿En qué *horario* te resulta más cómodo que te contactemos?\n' +
        '(Recuerda: L–V 4pm–9pm, S 9am–9pm)'
      );
      break;
    }
    case 'PERS_SCHEDULE': {
      session.personal.horario = incomingMsg;

      // Próximo paso según el flujo
      if (session.flow === 'Consulta técnica rápida') {
        session.state = 'QUICK_QUESTION';
        twiml.message(
          'Listo 👍\n\n' +
          '👉 Cuéntame en detalle cuál es tu *duda o problema técnico*.'
        );
      } else if (session.flow === 'Hablar con asesor') {
        session.state = 'HUMAN_CONTEXT';
        twiml.message(
          'Gracias.\n' +
          '👉 Cuéntame brevemente qué necesitas: mantenimiento, reparación, consulta técnica, licencias, etc.'
        );
      } else {
        // Mantenimiento / limpieza o Agendar cita en taller
        session.state = 'TECH_EQUIPMENT';
        twiml.message(
          'Perfecto, ahora algunos datos de tu equipo 💻\n\n' +
          '👉 ¿Qué tipo de equipo es y de qué *marca/modelo*? (Ej: Laptop HP Pavilion 14")'
        );
      }
      break;
    }

    // ---------- Consulta técnica rápida ----------
    case 'QUICK_QUESTION': {
      session.extra.consulta = incomingMsg;
      session.extra.recomendacion =
        'Requiere revisión por asesor (consulta técnica rápida).';

      // Enviar mensaje interno al operador
      await sendInternalMessage(buildInternalMessage(from, session));

      twiml.message(
        '✅ Hemos recibido tu *consulta técnica*.\n' +
        'Un asesor de MPC JSALA revisará tu información y te responderá por este medio dentro del horario de atención.\n\n' +
        'Si deseas volver al menú principal, escribe *menu*.'
      );

      resetSession(from);
      break;
    }

    // ---------- Hablar con asesor humano ----------
    case 'HUMAN_CONTEXT': {
      session.extra.consulta = incomingMsg;
      session.extra.recomendacion = 'Derivar a asesor humano.';

      await sendInternalMessage(buildInternalMessage(from, session));

      twiml.message(
        '🙋‍♂️ Listo, hemos registrado tu solicitud para hablar con un asesor.\n' +
        'Te contactaremos por este medio dentro del horario de atención.\n\n' +
        'Si deseas volver al menú principal, escribe *menu*.'
      );

      resetSession(from);
      break;
    }

    // ---------- Datos técnicos completos (para mantenimiento y cita en taller) ----------
    case 'TECH_EQUIPMENT': {
      session.technical.equipo = incomingMsg;
      session.state = 'TECH_OS';
      twiml.message(
        'Gracias.\n' +
        '👉 ¿Qué *sistema operativo* tiene? (Ej: Windows 10, Windows 11, etc.)'
      );
      break;
    }
    case 'TECH_OS': {
      session.technical.so = incomingMsg;
      session.state = 'TECH_DESC';
      twiml.message(
        'Perfecto.\n' +
        '👉 Describe brevemente el *problema principal* que presenta tu computadora.'
      );
      break;
    }
    case 'TECH_DESC': {
      session.technical.descripcion = incomingMsg;
      session.state = 'TECH_ON';
      twiml.message(
        'Gracias.\n' +
        '👉 ¿La computadora *enciende*? (responde "sí" o "no")'
      );
      break;
    }
    case 'TECH_ON': {
      session.technical.enciende = incomingMsg;
      session.state = 'TECH_SCREEN';
      twiml.message(
        'Entendido.\n' +
        '👉 ¿La pantalla se ve en negro, con rayas o con algún mensaje de error?'
      );
      break;
    }
    case 'TECH_SCREEN': {
      session.technical.pantalla = incomingMsg;
      session.state = 'TECH_EVOLUTION';
      twiml.message(
        'Gracias.\n' +
        '👉 ¿Este problema apareció de pronto o ha ido empeorando poco a poco?'
      );
      break;
    }
    case 'TECH_EVOLUTION': {
      session.technical.evolucion = incomingMsg;
      session.state = 'TECH_PREVIOUS';
      twiml.message(
        'Entiendo.\n' +
        '👉 ¿Ya fue revisada o reparada anteriormente por otra persona? (sí/no y detalles si aplica)'
      );
      break;
    }
    case 'TECH_PREVIOUS': {
      session.technical.revisado = incomingMsg;
      session.state = 'TECH_URGENCY';
      twiml.message(
        'Perfecto.\n' +
        '👉 ¿Necesitas el equipo para uso *urgente* (trabajo/estudio) en los próximos 2 días?'
      );
      break;
    }
    case 'TECH_URGENCY': {
      session.technical.urgencia = incomingMsg;

      if (session.flow === 'Mantenimiento y limpieza') {
        session.state = 'MAINT_LAST';
        twiml.message(
          'Gracias.\n' +
          '👉 ¿Hace cuánto tiempo fue el *último mantenimiento o limpieza interna* de tu computadora?'
        );
      } else if (session.flow === 'Agendar cita en taller') {
        session.state = 'APPOINTMENT_PREF';
        twiml.message(
          'Gracias.\n' +
          '👉 ¿Qué *día y franja horaria* te gustaría para la cita? (Ej: Viernes después de las 6 p.m.)'
        );
      } else {
        session.state = 'SERVICE_TYPE_DECISION';
        twiml.message('Un momento, analizando el tipo de servicio más adecuado…');
      }
      break;
    }

    // ---------- Extra mantenimiento ----------
    case 'MAINT_LAST': {
      session.extra.ultimoMantenimiento = incomingMsg;
      session.state = 'MAINT_SYMPTOMS';
      twiml.message(
        'Perfecto.\n' +
        '👉 ¿Has notado que se calienta más de lo normal, hace ruido fuerte o se apaga sola?'
      );
      break;
    }
    case 'MAINT_SYMPTOMS': {
      session.extra.sintomasMantenimiento = incomingMsg;
      session.state = 'SERVICE_TYPE_DECISION';
      twiml.message(
        'Gracias, con eso ya casi terminamos. Analizando el tipo de servicio más adecuado…'
      );
      break;
    }

    // ---------- Preferencia de cita (Agendar cita en taller) ----------
    case 'APPOINTMENT_PREF': {
      session.extra.preferenciaCita = incomingMsg;
      session.state = 'SERVICE_TYPE_DECISION';
      twiml.message('Perfecto, procesando tu solicitud de cita y tipo de servicio…');
      break;
    }

    // ---------- Decisión del tipo de servicio + cierre ----------
    case 'SERVICE_TYPE_DECISION': {
      const desc = session.technical.descripcion || '';
      const remote = isRemoteCandidate(desc);

      if (remote) {
        session.extra.recomendacion =
          'Posible soporte remoto (activación licencias / software). Coordinar sesión remota o entrega en taller.';

        twiml.message(
          '✅ Por la descripción, es posible que podamos ayudarte con *soporte remoto* ' +
          '(por ejemplo para activación de licencias de antivirus u Office, o ajustes de software).\n\n' +
          'No brindamos servicio a domicilio, pero podemos coordinar una *sesión remota* ' +
          'o la *entrega de tu equipo en taller*.\n' +
          'Un asesor revisará tu caso y te confirmará la mejor opción.'
        );
      } else {
        session.extra.recomendacion =
          'Recomendado revisión en taller (probable problema de hardware u otro que requiere revisión física).';

        twiml.message(
          '🔧 Por la descripción, lo más recomendable es una *revisión en taller*, ' +
          'ya que podría tratarse de un tema de hardware u otro problema que requiere revisión física.\n\n' +
          'No brindamos servicio a domicilio, pero podemos coordinar la *entrega de tu equipo en el taller* ' +
          'y la revisión con cita.\n' +
          'Un asesor revisará tu caso y te indicará los siguientes pasos.'
        );
      }

      // Enviar mensaje interno al operador con todos los datos
      await sendInternalMessage(buildInternalMessage(from, session));

      // Mensaje de cierre según el flujo
      if (session.flow === 'Mantenimiento y limpieza') {
        twiml.message(
          '🎉 ¡Listo! Hemos registrado tu solicitud de *mantenimiento y limpieza*.\n' +
          'Un asesor de MPC JSALA te contactará por WhatsApp para confirmar la cita y los detalles del servicio.\n\n' +
          'Si deseas volver al menú principal, escribe *menu*.'
        );
      } else if (session.flow === 'Agendar cita en taller') {
        twiml.message(
          '🗓️ Tu *solicitud de cita en taller* ha sido registrada.\n' +
          'Te contactaremos pronto para confirmar la hora exacta y la forma de entrega de tu equipo.\n\n' +
          'Si deseas volver al menú principal, escribe *menu*.'
        );
      } else {
        twiml.message(
          '✅ Hemos registrado tu solicitud.\n' +
          'Un asesor de MPC JSALA revisará la información y te contactará por este medio.\n\n' +
          'Si deseas volver al menú principal, escribe *menu*.'
        );
      }

      resetSession(from);
      break;
    }

    // ---------- Estado de servicio en curso ----------
    case 'STATUS_DATA': {
      session.extra.estadoServicio = `Nombre: ${incomingMsg}`;
      session.state = 'STATUS_ORDER';
      twiml.message(
        'Gracias.\n' +
        '👉 Si tienes un *número de orden o referencia*, escríbelo aquí. Si no lo tienes, responde "no".'
      );
      break;
    }
    case 'STATUS_ORDER': {
      session.extra.estadoServicio += ` | Orden/Ref: ${incomingMsg}`;
      session.state = 'STATUS_DATE';
      twiml.message(
        'Perfecto.\n' +
        '👉 ¿Aproximadamente en qué *fecha* dejaste el equipo en el taller?'
      );
      break;
    }
    case 'STATUS_DATE': {
      session.extra.estadoServicio += ` | Fecha ingreso: ${incomingMsg}`;
      session.extra.recomendacion =
        'Consultar estado de servicio en taller y responder al cliente.';

      await sendInternalMessage(buildInternalMessage(from, session));

      twiml.message(
        '🔎 Hemos registrado tu solicitud para consultar el *estado de tu servicio*.\n' +
        'Un asesor revisará la información y te enviará una actualización por este medio.\n\n' +
        'Si deseas volver al menú principal, escribe *menu*.'
      );

      resetSession(from);
      break;
    }

    // ---------- Falla / estado desconocido ----------
    default: {
      resetSession(from);
      twiml.message(
        'Ocurrió un pequeño inconveniente con la conversación. Vamos a empezar de nuevo 😊\n\n' +
        'Escribe *menu* para ver las opciones nuevamente.'
      );
      break;
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

// ---------- Levantar servidor ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('MPC JSALA WhatsApp bot escuchando en puerto ' + PORT);
});
