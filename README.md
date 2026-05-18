# MAIZITOS

Sitio web para el restaurante campestre MAIZITOS.

## Estructura

- `index.html`: entrada principal del sitio.
- `src/main.js`: inicializa la página.
- `src/components/`: vistas publica y administrativa.
- `src/api/`: cliente HTTP para consumir la API.
- `src/styles/`: estilos globales.
- `src/data/`: contenido editable del sitio.
- `server/`: API local, datos JSON y servicio de confirmación de reservas.
- `public/assets/`: imágenes, íconos y fuentes públicas.

## Comandos

```bash
npm install
npm run api
npm run dev
```

La API corre por defecto en `http://localhost:4000` y el frontend en el puerto que indique Vite.

Para probar la web publicada desde un solo servidor:

```bash
npm run build
npm run start
```

Eso sirve la web y la API juntas en `http://localhost:4000`.

Para generar un link publico temporal:

```bash
npx --yes localtunnel --port 4000
```

El link funcionara mientras `npm run start` y `localtunnel` sigan corriendo.

## Publicar en Render

El proyecto incluye `render.yaml` para crear un Web Service en Render.

Pasos:

1. Sube el proyecto a GitHub sin subir `.env`.
2. En Render, crea un nuevo Blueprint desde ese repositorio.
3. Render detectara `render.yaml`.
4. Configura estas variables cuando Render las solicite:

```env
SMTP_USER=correo@gmail.com
SMTP_PASS=contrasena_de_aplicacion
SMTP_FROM="MAIZITOS Reservas <correo@gmail.com>"
RESTAURANT_EMAIL=correo@gmail.com
```

Render ejecutara:

```bash
npm install && npm run build
npm run start
```

En el plan gratuito, el servicio puede dormirse por inactividad y el filesystem
es efimero. Para no perder reservas, usuarios o cambios de carta en despliegues
reales, se debe migrar `server/data/*.json` a una base de datos.

## Panel del dueño

Abre `/admin` en el frontend.

En el primer acceso, el sistema pedira crear un superusuario unico. Ese usuario
puede crear cuentas admin, activar/desactivar usuarios, ver usuarios existentes
y aprobar solicitudes de cambio de contraseña.

Las contraseñas deben tener al menos 12 caracteres e incluir mayuscula,
minuscula, numero y simbolo.

## Seguridad del panel

- Contraseñas hasheadas con `scrypt` y sal aleatoria.
- Sesiones firmadas con expiracion.
- Bloqueo temporal tras intentos fallidos.
- Rutas admin protegidas por rol.
- El superusuario solo se crea una vez, durante el primer acceso.
- Los administradores pueden solicitar cambio de contraseña; el superusuario lo
  aprueba o rechaza.

## Correo de reservas

Cuando un cliente reserva, la API confirma la reserva y envia un correo por SMTP
si existen credenciales en `.env`. En desarrollo, o si faltan credenciales, el
correo queda registrado como simulado en `server/storage/emails.json`.

Configuracion Gmail:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=correo@gmail.com
SMTP_PASS=contrasena_de_aplicacion
SMTP_FROM="MAIZITOS Reservas <correo@gmail.com>"
```

La clave debe ser una contraseña de aplicacion de Google. No uses la contraseña
normal de Gmail. El archivo `.env` esta ignorado para evitar subir credenciales.
