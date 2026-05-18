import { readJson, writeJson } from './store.js';
import nodemailer from 'nodemailer';

let smtpTransporter;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === 'true' ||
    (!process.env.SMTP_SECURE && port === 465);

  return {
    host,
    port,
    secure,
    auth: { user, pass }
  };
}

function getTransporter() {
  const config = getSmtpConfig();

  if (!config) {
    return null;
  }

  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport(config);
  }

  return smtpTransporter;
}

function buildReservationMessage(reservation) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'MAIZITOS <reservas@maizitos.com>';
  const restaurantEmail = process.env.RESTAURANT_EMAIL || process.env.SMTP_USER;
  const safeName = escapeHtml(reservation.name);
  const safeDate = escapeHtml(reservation.date);
  const safeTime = escapeHtml(reservation.time);
  const safeGuests = escapeHtml(reservation.guests);
  const safePhone = escapeHtml(reservation.phone);
  const safeNotes = escapeHtml(reservation.notes || 'Sin observaciones');

  return {
    id: `email-${reservation.id}`,
    from,
    to: reservation.email,
    replyTo: restaurantEmail,
    subject: `Reserva confirmada en MAIZITOS - ${reservation.date}`,
    createdAt: new Date().toISOString(),
    text: [
      `Hola ${reservation.name}, recibimos tu reserva en MAIZITOS.`,
      '',
      `Fecha: ${reservation.date}`,
      `Hora: ${reservation.time}`,
      `Personas: ${reservation.guests}`,
      `Telefono: ${reservation.phone}`,
      `Notas: ${reservation.notes || 'Sin observaciones'}`,
      '',
      'Te esperamos.'
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #241b11; line-height: 1.5;">
        <h1 style="margin: 0 0 16px;">Reserva confirmada</h1>
        <p>Hola ${safeName}, recibimos tu reserva en <strong>MAIZITOS</strong>.</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tbody>
            <tr>
              <td style="padding: 6px 14px 6px 0;"><strong>Fecha</strong></td>
              <td style="padding: 6px 0;">${safeDate}</td>
            </tr>
            <tr>
              <td style="padding: 6px 14px 6px 0;"><strong>Hora</strong></td>
              <td style="padding: 6px 0;">${safeTime}</td>
            </tr>
            <tr>
              <td style="padding: 6px 14px 6px 0;"><strong>Personas</strong></td>
              <td style="padding: 6px 0;">${safeGuests}</td>
            </tr>
            <tr>
              <td style="padding: 6px 14px 6px 0;"><strong>Telefono</strong></td>
              <td style="padding: 6px 0;">${safePhone}</td>
            </tr>
            <tr>
              <td style="padding: 6px 14px 6px 0;"><strong>Notas</strong></td>
              <td style="padding: 6px 0;">${safeNotes}</td>
            </tr>
          </tbody>
        </table>
        <p>Te esperamos. Si necesitas ajustar la reserva, responde este correo.</p>
      </div>
    `
  };
}

async function storeEmailLog(message) {
  const emails = await readJson('emails');
  emails.unshift(message);
  await writeJson('emails', emails);
}

export async function sendReservationEmail(reservation) {
  const message = buildReservationMessage(reservation);
  const transporter = getTransporter();

  if (!transporter) {
    console.warn('Correo de reserva en modo simulado: faltan variables SMTP.');
    await storeEmailLog({ ...message, deliveryStatus: 'simulated' });
    return { ...message, deliveryStatus: 'simulated' };
  }

  try {
    const result = await transporter.sendMail(message);
    const sentMessage = {
      ...message,
      deliveryStatus: 'sent',
      providerMessageId: result.messageId
    };

    await storeEmailLog(sentMessage);
    console.log(`Correo de reserva enviado a ${reservation.email}: ${result.messageId}`);
    return sentMessage;
  } catch (error) {
    const failedMessage = {
      ...message,
      deliveryStatus: 'failed',
      error: error.message
    };

    await storeEmailLog(failedMessage);
    console.error('No se pudo enviar el correo de reserva:', error.message);
    return failedMessage;
  }
}
