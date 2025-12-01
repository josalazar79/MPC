/**
 * MPC Jsala — WhatsApp Bot (Twilio + OpenAI)
 * Funcionalidades:
 * - Menú principal (Reparación / Mantenimiento / Otros)
 * - Precios automáticos
 * - Pedir nombre y ubicación
 * - Agenda de cita simple
 * - Multi-sucursal (selección y info)
 * - IA fallback con OpenAI
 * - Persistencia ligera con lowdb (db.json)
 * - Endpoint admin protegido para ver citas
 *
 * CONFIG: crear .env (ver ejemplo)
 */

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

// --- DB (lowdb) setup ---
const adapter = new JSONFile('db.json');
const db = new Low(adapter);

async function initDB() {
  await db.read();
  db.data ||= {
    sessions: {},       // sesiones temporales por número
    appointments: [],   // citas agendadas
    branches: [         // sucursales (multi-branch)
      {
        id: 'sjo-centro',
        name: 'MPC Jsala - Sucursal Centro (San José)',
        address: 'Calle Principal #123, San José',
        phone: '+50688898177',
        hours: 'Lun-Vie 8:00-17:00'
      },
      {
        id: 'palmares',
        name: 'MPC Jsala - Palmares',
        address: 'Av. Secundaria #45, Palmares',
        phone: '+50688898178',
        hours: 'Lun-Sáb 9:00-15:00'
      }
    ],
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

// --- OpenAI setup ---
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// --- Helpers ---
function twReply(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
}

function mainMenu() {
  return `
🖥️ *MPC JSALA - Menú Principal*

Selecciona una opción (escribe el número):
1️⃣ Reparación de computadoras
2️⃣ Mantenimiento de computadoras
3️⃣ Otros servicios
4️⃣ Sucursales / Ubicaciones
5️⃣ Agenda una cita
6️⃣ Precios / Productos
ESCRIBE: *MENU* para volver aquí en cualquier momento.
`;
}

function branchList(branches) {
  let text = '🏢 *Sucursales disponibles:*\n\n';
  branches.forEach((b, i) => {
    text += `${i + 1}. ${b.name} — ${b.address} — Horario: ${b.hours}\n`;
  });
  text += `\nEscribe el número de la sucursal para elegirla.`;
  return text;
}

function pricesText(prices, inventory) {
  let t = '💲 *Precios principales*\n\n';
  t += `• Reparación (mínimo): ₡${prices.reparacion_minima}\n`;
  t += `• Formateo e instalación: ₡${prices.formateo}\n`;
  t += `• Mantenimiento (limpieza + diagnóstico): ₡${prices.limpieza}\n`;
  t += `• Cambio de pasta térmica: ₡${prices.pasta_termica}\n\n`;
  t += '📦 *Inventario disponible:*\n';
  for (const [k, it] of Object.entries(inventory)) {
    t += `- ${it.name}: ₡${it.price} (stock: ${it.stock})\n`;
  }
  return t;
}

// --- Webhook principal para Twilio WhatsApp ---
app.post('/whatsapp', async (req, res) => {
  const from = req.body.From || req.body.from; // formato "whatsapp:+506..."
  const rawMsg = (req.body.Body || req.body.body || '').toString().trim();
  const msg = rawMsg.toLowerCase();

  await db.read();
  const sessions = db.data.sessions;

  // Init session if not exists
  if (!sessions[from]) {
    sessions[from] = {
      step: 'welcome',
      data: {}
    };
    await db.write();
    return twReply(res, `¡Hola! 👋 Soy MPC Jsala.\n\n${mainMenu()}`);
  }

  const session = sessions[from];

  // universal commands
  if (msg === 'menu' || msg === 'inicio' || msg === 'home') {
    session.step = 'menu';
    session.data = {};
    await db.write();
    return twReply(res, mainMenu());
  }

  // Flow by step or direct choice
  // If user is at 'welcome' or 'menu', interpret numbers
  if (session.step === 'welcome' || session.step === 'menu') {
    switch (msg) {
      case '1':
      case '1️⃣':
        session.step = 'reparacion_start';
        session.data.topic = 'reparacion';
        await db.write();
        return twReply(res, `
🔧 *Reparación de Computadoras*
Ofrecemos formateo, eliminación de virus, reparación de hardware, recuperación de datos...
¿Podrías describir el problema que tienes? (Ej: "No enciende", "Pantalla azul", "Virus")
Escribe tu descripción.
`);
      case '2':
      case '2️⃣':
        session.step = 'mantenimiento_start';
        session.data.topic = 'mantenimiento';
        await db.write();
        return twReply(res, `
🧹 *Mantenimiento de Computadoras*
Incluye limpieza interna, cambio de pasta térmica, diagnóstico.
¿Quieres agendar ahora o prefieres que te enviemos el precio estimado? (responde: "agendar" o "precio")
`);
      case '3':
      case '3️⃣':
        session.step = 'otros_start';
        session.data.topic = 'otros';
        await db.write();
        return twReply(res, `
📌 *Otros servicios*
Soporte remoto, instalación de programas, redes, impresoras, venta de accesorios.
Escribe qué servicio necesitas o escribe "catalogo" para ver inventario.
`);
      case '4':
      case '4️⃣':
        session.step = 'branches';
        await db.write();
        return twReply(res, branchList(db.data.branches));
      case '5':
      case '5️⃣':
        session.step = 'ask_branch_for_appointment';
        await db.write();
        return twReply(res, `Perfecto, vamos a agendar. Primero, elige la sucursal:\n\n${branchList(db.data.branches)}`);
      case '6':
      case '6️⃣':
        await db.write();
        return twReply(res, pricesText(db.data.prices, db.data.inventory));
      default:
        // If numeric but unknown
        // Fall through to AI fallback later
        break;
    }
  }

  // Branch selection when needed
  if (session.step === 'branches') {
    const idx = parseInt(msg);
    if (!isNaN(idx) && idx >= 1 && idx <= db.data.branches.length) {
      const b = db.data.branches[idx - 1];
      session.data.selectedBranch = b.id;
      session.step = 'menu';
      await db.write();
      return twReply(res, `Has seleccionado: *${b.name}*\n\nDirección: ${b.address}\nHorario: ${b.hours}\n\n${mainMenu()}`);
    } else {
      return twReply(res, `Número inválido. ${branchList(db.data.branches)}`);
    }
  }

  // Appointment flow
  if (session.step === 'ask_branch_for_appointment') {
    const idx = parseInt(msg);
    if (!isNaN(idx) && idx >= 1 && idx <= db.data.branches.length) {
      const branch = db.data.branches[idx - 1];
      session.data.appointment = { branchId: branch.id };
      session.step = 'ask_name_for_appointment';
      await db.write();
      return twReply(res, `Perfecto. Elegiste *${branch.name}*.\n¿Me das tu nombre completo para la cita?`);
    } else {
      return twReply(res, `Número inválido. ${branchList(db.data.branches)}`);
    }
  }

  if (session.step === 'ask_name_for_appointment') {
    session.data.appointment.name = rawMsg;
    session.step = 'ask_phone_for_appointment';
    await db.write();
    return twReply(res, `Gracias *${rawMsg}*. ¿Cuál es el número de teléfono donde te contactamos (si es diferente al que usas)? Si es el mismo, escribe "mismo".`);
  }

  if (session.step === 'ask_phone_for_appointment') {
    session.data.appointment.phone = (rawMsg.toLowerCase() === 'mismo') ? from.replace('whatsapp:', '') : rawMsg;
    session.step = 'ask_date_for_appointment';
    await db.write();
    return twReply(res, `Perfecto. ¿Qué fecha prefieres para la cita? (ej: 2025-12-05 o "mañana" o "próxima semana")`);
  }

  if (session.step === 'ask_date_for_appointment') {
    session.data.appointment.date = rawMsg;
    session.step = 'ask_time_for_appointment';
    await db.write();
    return twReply(res, `Hora preferida (ej: 10:00 AM o 15:30):`);
  }

  if (session.step === 'ask_time_for_appointment') {
    session.data.appointment.time = rawMsg;
    session.step = 'confirm_appointment';
    // create appointment
    const id = nanoid(8);
    const ap = {
      id,
      createdAt: new Date().toISOString(),
      from,
      ...session.data.appointment
    };
    db.data.appointments.push(ap);
    // clear appointment partial data
    session.step = 'menu';
    session.data.appointment = null;
    await db.write();
    return twReply(res, `✅ *Cita agendada con éxito*\nID: ${id}\nSucursal: ${ap.branchId}\nNombre: ${ap.name}\nTel: ${ap.phone}\nFecha: ${ap.date}\nHora: ${ap.time}\n\nTe contactaremos para confirmar.\n\n${mainMenu()}`);
  }

  // Reparacion flow - ask problem then ask for name/location and propose price
  if (session.step === 'reparacion_start') {
    // user described problem
    session.data.problem = rawMsg;
    session.step = 'reparacion_ask_contact';
    await db.write();
    return twReply(res, `Gracias por la descripción:\n"${rawMsg}"\n\nPara darte un presupuesto y agendar, ¿puedes darme tu nombre completo?`);
  }

  if (session.step === 'reparacion_ask_contact') {
    session.data.name = rawMsg;
    session.step = 'reparacion_ask_location';
    await db.write();
    return twReply(res, `Gracias ${rawMsg}. ¿Cuál es la ubicación (barrio/ciudad) o prefieres llevar el equipo a la sucursal? (responde: "llevar" o escribe tu ubicación)`);
  }

  if (session.step === 'reparacion_ask_location') {
    session.data.location = rawMsg;
    // quick price estimate (simple logic)
    const base = db.data.prices.reparacion_minima;
    let estimate = base;
    if (session.data.problem.includes('no enciende') || session.data.problem.includes('pantalla')) {
      estimate += 15000;
    } else if (session.data.problem.includes('virus') || session.data.problem.includes('malware')) {
      estimate += 8000;
    }
    session.step = 'menu';
    await db.write();
    return twReply(res, `💰 *Estimado preliminar*: ₡${estimate}\n(Este es un estimado; el precio final depende del diagnóstico completo).\n\n¿Quieres que te agendemos una cita para diagnóstico? Responde "agendar" o "no".\n\n${mainMenu()}`);
  }

  // Mantenimiento flow - handle 'agendar' or 'precio'
  if (session.step === 'mantenimiento_start') {
    if (msg.includes('agendar')) {
      session.step = 'ask_branch_for_appointment';
      await db.write();
      return twReply(res, `Perfecto, elige la sucursal para agendar:\n\n${branchList(db.data.branches)}`);
    } else if (msg.includes('precio') || msg.includes('costo')) {
      await db.write();
      return twReply(res, pricesText(db.data.prices, db.data.inventory));
    } else {
      // fallback
      session.step = 'menu';
      await db.write();
      return twReply(res, `No entendí. Puedes escribir "agendar" o "precio".\n\n${mainMenu()}`);
    }
  }

  // Otros services
  if (session.step === 'otros_start') {
    if (msg.includes('catalogo') || msg.includes('inventario')) {
      await db.write();
      return twReply(res, pricesText(db.data.prices, db.data.inventory));
    } else {
      // Save request and offer human transfer
      session.data.request = rawMsg;
      session.step = 'menu';
      await db.write();
      return twReply(res, `Gracias. Hemos recibido tu solicitud: "${rawMsg}".\nUn agente humano te contactará pronto.\n\n${mainMenu()}`);
    }
  }

  // If none matched and user wants AI help
  if (msg.startsWith('ai ') || msg.startsWith('gpt ') || msg.startsWith('chat ')) {
    const userPrompt = rawMsg.replace(/^ai\s+|^gpt\s+|^chat\s+/i, '');
    if (!openai) {
      return twReply(res, `Lo siento, el servicio de IA no está configurado en el servidor. Contacta al administrador.`);
    }
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // alternar según disponibilidad
        messages: [
          { role: 'system', content: 'Eres un asistente técnico para MPC Jsala. Responde en español, conciso, amigable.' },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 500
      });
      const assistantText = completion.choices?.[0]?.message?.content;
      return twReply(res, assistantText || 'Lo siento, no obtuve una respuesta del servicio de IA.');
    } catch (err) {
      console.error('OpenAI error:', err);
      return twReply(res, 'Error en IA: intenta más tarde.');
    }
  }

  // Last resort: if openai configured, ask user if wants AI help
  if (openai) {
    try {
      const prompt = `Eres un asistente para MPC Jsala. Usuario: "${rawMsg}". Responde brevemente en español y ofrece: (1) sugerencia automática, (2) pregunta para obtener más detalles, (3) ofrecer agendar si es pertinente.`;
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Eres soporte técnico para un taller de reparación de computadoras, habla en español corto y directo.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 300
      });
      const aiResp = completion.choices?.[0]?.message?.content;
      // fallback if null
      if (aiResp) {
        return twReply(res, `${aiResp}\n\nEscribe "MENU" para volver al menú principal.`);
      }
    } catch (err) {
      console.error('OpenAI fallback error:', err);
      // continue to generic fallback
    }
  }

  // Generic fallback
  return twReply(res, `🤖 Lo siento, no entendí completamente. Puedes escribir "MENU" para ver opciones o "AI <tu pregunta>" para usar asistencia inteligente.\n\n${mainMenu()}`);
});

// --- Admin: listar citas (protegido por token simple) ---
app.get('/admin/appointments', async (req, res) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  await db.read();
  res.json({ appointments: db.data.appointments });
});

// --- Admin: listar DB resumen ---
app.get('/admin/db', async (req, res) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  await db.read();
  res.json(db.data);
});

// --- Health check ---
app.get('/health', (req, res) => res.send('ok'));

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MPC Jsala WhatsApp Bot corriendo en puerto ${PORT}`);
});
