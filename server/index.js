import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, normalize, resolve } from 'node:path';
import {
  authStatus,
  createAdminUser,
  listUsers,
  loginUser,
  requestPasswordChange,
  requireUser,
  reviewPasswordRequest,
  safeUser,
  setupSuperuser,
  updateUserStatus
} from './lib/auth.js';
import { loadEnv } from './lib/env.js';
import { readJson, writeJson } from './lib/store.js';
import { sendReservationEmail } from './lib/mailer.js';

loadEnv();

const port = Number(process.env.PORT || 4000);
const distDir = resolve(process.cwd(), 'dist');
const staticContentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  sendJson(res, 404, { error: 'Ruta no encontrada' });
}

function sendStaticFile(req, res, filePath) {
  const contentType = staticContentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable'
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

async function serveFrontend(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    notFound(res);
    return;
  }

  let pathname;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    notFound(res);
    return;
  }

  const normalizedPath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = resolve(distDir, `.${normalizedPath}`);

  if (!filePath.startsWith(distDir)) {
    notFound(res);
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = resolve(filePath, 'index.html');
    }
  } catch {
    filePath = resolve(distDir, 'index.html');
  }

  try {
    await stat(filePath);
    sendStaticFile(req, res, filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Ejecuta npm run build antes de publicar la web.');
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function validateReservation(input) {
  const required = ['name', 'email', 'phone', 'date', 'time', 'guests'];
  const missing = required.filter((field) => !String(input[field] || '').trim());

  if (missing.length) {
    return `Faltan campos: ${missing.join(', ')}`;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return 'La fecha debe tener formato YYYY-MM-DD';
  }

  if (!/^\d{2}:\d{2}$/.test(input.time)) {
    return 'La hora debe tener formato HH:mm';
  }

  if (Number(input.guests) < 1) {
    return 'La cantidad de personas debe ser mayor a cero';
  }

  return null;
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      sendJson(res, 200, await authStatus());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/setup-superuser') {
      sendJson(res, 201, await setupSuperuser(await readBody(req)));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      sendJson(res, 200, await loginUser(await readBody(req)));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const actor = await requireUser(req);
      sendJson(res, 200, safeUser(actor));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/password-change-requests') {
      const actor = await requireUser(req);
      sendJson(res, 201, await requestPasswordChange(actor, await readBody(req)));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/menu') {
      const dishes = await readJson('dishes');
      sendJson(res, 200, dishes.filter((dish) => dish.active));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/availability') {
      const date = url.searchParams.get('date');
      const [dishes, availability] = await Promise.all([readJson('dishes'), readJson('availability')]);
      const availableIds = availability[date] || [];
      sendJson(
        res,
        200,
        dishes.filter((dish) => dish.active && availableIds.includes(dish.id))
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/reservations') {
      const input = await readBody(req);
      const error = validateReservation(input);

      if (error) {
        sendJson(res, 400, { error });
        return;
      }

      const reservations = await readJson('reservations');
      const reservation = {
        id: `res-${Date.now()}`,
        name: input.name.trim(),
        email: input.email.trim(),
        phone: input.phone.trim(),
        date: input.date,
        time: input.time,
        guests: Number(input.guests),
        notes: String(input.notes || '').trim(),
        status: 'confirmada',
        createdAt: new Date().toISOString()
      };

      reservations.unshift(reservation);
      await writeJson('reservations', reservations);
      const emailDelivery = await sendReservationEmail(reservation);
      reservation.emailDeliveryStatus = emailDelivery.deliveryStatus;
      reservation.emailProviderMessageId = emailDelivery.providerMessageId || null;
      reservation.emailDeliveryError = emailDelivery.error || null;
      await writeJson('reservations', reservations);

      sendJson(res, 201, reservation);
      return;
    }

    if (parts[0] === 'api' && parts[1] === 'admin') {
      const actor = await requireUser(req);

      if (req.method === 'GET' && parts[2] === 'reservations') {
        sendJson(res, 200, await readJson('reservations'));
        return;
      }

      if (req.method === 'DELETE' && parts[2] === 'reservations' && parts[3]) {
        await requireUser(req, ['superuser']);
        const reservations = await readJson('reservations');
        const reservationIndex = reservations.findIndex((reservation) => reservation.id === parts[3]);

        if (reservationIndex === -1) {
          sendJson(res, 404, { error: 'Reserva no encontrada' });
          return;
        }

        const [deleted] = reservations.splice(reservationIndex, 1);
        await writeJson('reservations', reservations);
        sendJson(res, 200, deleted);
        return;
      }

      if (req.method === 'GET' && parts[2] === 'dishes') {
        sendJson(res, 200, await readJson('dishes'));
        return;
      }

      if (req.method === 'POST' && parts[2] === 'dishes') {
        const input = await readBody(req);
        const dishes = await readJson('dishes');
        const id = slugify(input.name || `plato-${Date.now()}`);
        const dish = {
          id,
          name: input.name,
          category: input.category || 'Carta',
          description: input.description || '',
          price: Number(input.price || 0),
          active: input.active !== false
        };

        dishes.unshift(dish);
        await writeJson('dishes', dishes);
        sendJson(res, 201, dish);
        return;
      }

      if ((req.method === 'PUT' || req.method === 'DELETE') && parts[2] === 'dishes' && parts[3]) {
        const dishes = await readJson('dishes');
        const dishIndex = dishes.findIndex((dish) => dish.id === parts[3]);

        if (dishIndex === -1) {
          sendJson(res, 404, { error: 'Plato no encontrado' });
          return;
        }

        if (req.method === 'DELETE') {
          const [deleted] = dishes.splice(dishIndex, 1);
          await writeJson('dishes', dishes);
          sendJson(res, 200, deleted);
          return;
        }

        const input = await readBody(req);
        dishes[dishIndex] = {
          ...dishes[dishIndex],
          name: input.name,
          category: input.category,
          description: input.description,
          price: Number(input.price || 0),
          active: input.active !== false
        };
        await writeJson('dishes', dishes);
        sendJson(res, 200, dishes[dishIndex]);
        return;
      }

      if (req.method === 'GET' && parts[2] === 'availability') {
        sendJson(res, 200, await readJson('availability'));
        return;
      }

      if (req.method === 'PUT' && parts[2] === 'availability' && parts[3]) {
        const input = await readBody(req);
        const availability = await readJson('availability');
        availability[parts[3]] = Array.isArray(input.dishIds) ? input.dishIds : [];
        await writeJson('availability', availability);
        sendJson(res, 200, { date: parts[3], dishIds: availability[parts[3]] });
        return;
      }

      if (parts[2] === 'users') {
        await requireUser(req, ['superuser']);

        if (req.method === 'GET') {
          sendJson(res, 200, await listUsers());
          return;
        }

        if (req.method === 'POST') {
          sendJson(res, 201, await createAdminUser(actor, await readBody(req)));
          return;
        }

        if (req.method === 'PUT' && parts[3]) {
          const input = await readBody(req);
          sendJson(res, 200, await updateUserStatus(actor, parts[3], input.active));
          return;
        }
      }

      if (parts[2] === 'password-requests' && parts[3] && parts[4]) {
        await requireUser(req, ['superuser']);

        if (req.method === 'POST' && parts[4] === 'approve') {
          sendJson(res, 200, await reviewPasswordRequest(actor, parts[3], 'approved'));
          return;
        }

        if (req.method === 'POST' && parts[4] === 'reject') {
          sendJson(res, 200, await reviewPasswordRequest(actor, parts[3], 'rejected'));
          return;
        }
      }
    }

    if (parts[0] !== 'api') {
      await serveFrontend(req, res, url);
      return;
    }

    notFound(res);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || 'Error interno' });
  }
}

createServer(handleRequest).listen(port, () => {
  console.log(`MAIZITOS API escuchando en http://localhost:${port}`);
  console.log(`MAIZITOS web publicada en http://localhost:${port}`);
  console.log(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
      ? `Correo de reservas: SMTP activo (${process.env.SMTP_USER})`
      : 'Correo de reservas: modo simulado'
  );
});
