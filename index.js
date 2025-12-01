const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Sesiones en memoria (simple y funcional)
const sesiones = {};

// ✅ MENÚ PRINCIPAL
const menu = `
🖥️ *MPC JSALA*  
Servicio técnico especializado

1️⃣ Reparación de computadoras  
2️⃣ Mantenimiento de computadora  
3️⃣ Otros servicios  

Escribe el número de la opción.
Escribe MENU para volver.
`;

// ✅ RESPUESTA WHATSAPP
function responder(res, texto) {
  const twiml = new MessagingResponse();
  twiml.message(texto);
  res.type('text/xml');
  res.send(twiml.toString());
}

// ✅ WEBHOOK TWILIO
app.post('/whatsapp', (req, res) => {
  const numero = req.body.From;
  const mensaje = req.body.Body.trim().toLowerCase();

  if (!sesiones[numero]) {
    sesiones[numero] = { estado: "menu", data: {} };
    return responder(res, menu);
  }

  const session = sesiones[numero];

  // VOLVER AL MENU
  if (mensaje === "menu") {
    session.estado = "menu";
    session.data = {};
    return responder(res, menu);
  }

  // ---------------- MENU ----------------
  if (session.estado === "menu") {
    switch (mensaje) {
      case "1":
        session.estado = "reparacion";
        return responder(res, "🔧 Describe el problema de tu computadora:");

      case "2":
        session.estado = "mantenimiento";
        return responder(res, "🧼 ¿Deseas *PRECIO* o *AGENDAR* mantenimiento?");

      case "3":
        session.estado = "otros";
        return responder(res, "✍️ Describe el servicio que necesitas:");

      default:
        return responder(res, "❌ Opción inválida\n" + menu);
    }
  }

  // ---------------- REPARACIÓN ----------------
  if (session.estado === "reparacion") {
    session.data.problema = mensaje;
    session.estado = "menu";
    return responder(res,
      "✅ Tu solicitud fue recibida.\nPronto un técnico se comunicará contigo.\n\n" + menu);
  }

  // ---------------- MANTENIMIENTO ----------------
  if (session.estado === "mantenimiento") {
    if (mensaje.includes("precio")) {
      return responder(res,
`💰 *PRECIOS MPC JSALA*
🧼 Mantenimiento: ₡15,000
🔧 Reparación mínima: ₡12,000

Escribe *AGENDAR* para cita.`);
    }

    if (mensaje.includes("agendar")) {
      session.estado = "cita_nombre";
      return responder(res, "👤 Indícanos tu nombre completo:");
    }

    return responder(res, "Escribe *PRECIO* o *AGENDAR*");
  }

  // ---------------- OTROS ----------------
  if (session.estado === "otros") {
    session.estado = "menu";
    return responder(res,
      "✅ Solicitud registrada.\nTe contactaremos pronto.\n\n" + menu);
  }

  // ---------------- CITA ----------------
  if (session.estado === "cita_nombre") {
    session.data.nombre = mensaje;
    session.estado = "cita_fecha";
    return responder(res, "📅 Fecha deseada:");
  }

  if (session.estado === "cita_fecha") {
    session.data.fecha = mensaje;
    session.estado = "cita_hora";
    return responder(res, "⏰ Hora aproximada:");
  }

  if (session.estado === "cita_hora") {
    const { nombre, fecha } = session.data;
    session.estado = "menu";
    session.data = {};
    return responder(res,
`✅ *CITA CONFIRMADA*
👤 ${nombre}
📅 ${fecha}
⏰ ${mensaje}

Gracias por preferir *MPC JSALA* 💻
\n${menu}`);
  }

  // FALLBACK
  return responder(res, menu);
});

// ✅ SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ BOT MPC JSALA ACTIVO EN EL PUERTO " + PORT));

