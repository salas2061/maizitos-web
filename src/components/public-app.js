import { api } from '../api/client.js';
import { formatPrice, today } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

export async function renderPublicApp(root, content) {
  root.innerHTML = `
    <header class="site-header">
      <a class="brand" href="/" aria-label="${content.brand}">
        <span class="brand-mark">M</span>
        <span>${content.brand}</span>
      </a>
      <nav class="site-nav" aria-label="Navegación principal">
        <a href="#nosotros">Nosotros</a>
        <a href="#carta">La carta</a>
        <a href="#galeria">Galería</a>
        <a href="#reservas">Reservas</a>
        <a href="#contacto">Contacto</a>
        <button class="nav-action" type="button" data-open-reservation>Reservar</button>
      </nav>
    </header>

    <main>
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p>${content.tagline}</p>
          <h1 id="hero-title">${content.brand}</h1>
          <span>Cocina de campo, maíz fresco y mesas abiertas para almuerzos largos en familia.</span>
          <div class="hero-actions">
            <button class="primary-action" type="button" data-open-reservation>Reservar mesa</button>
            <a class="secondary-action" href="#carta">Ver la carta</a>
          </div>
        </div>
      </section>

      <section class="section intro-section" id="nosotros" aria-labelledby="about-title">
        <div class="section-kicker">Nosotros</div>
        <div class="intro-grid">
          <h2 id="about-title">Una mesa campestre alrededor del maíz.</h2>
          <div class="rich-copy">
            <p>
              MAIZITOS reúne recetas familiares, insumos frescos y preparaciones de fin de semana
              en un ambiente verde, cálido y sin apuro.
            </p>
            <p>
              La carta cambia por fecha para trabajar con productos disponibles y platos recién
              preparados. Antes de reservar puedes consultar qué habrá en cocina ese día.
            </p>
          </div>
        </div>
      </section>

      <section class="image-band" aria-label="Ambiente del restaurante">
        <div>
          <strong>Terraza abierta</strong>
          <span>Jardines, fogón y mesas familiares.</span>
        </div>
      </section>

      <section class="section menu-section" id="carta" aria-labelledby="menu-title">
        <div class="section-heading">
          <p>La carta</p>
          <h2 id="menu-title">Especialidades de temporada</h2>
        </div>
        <div class="menu-link-grid">
          ${content.menuHighlights
            .map(
              (item) => `
                <a class="menu-link" href="#reservas">
                  <span>${item}</span>
                  <strong>Consultar fecha</strong>
                </a>
              `
            )
            .join('')}
        </div>
      </section>

      <section class="section availability-section" id="reservas" aria-labelledby="availability-title">
        <div class="availability-copy">
          <p>Reservas</p>
          <h2 id="availability-title">Elige una fecha y revisa qué platos estarán disponibles.</h2>
          <label class="field inline-field">
            <span>Fecha de visita</span>
            <input id="availability-date" type="date" value="${today()}" />
          </label>
          <button class="primary-action" type="button" data-open-reservation>Reservar ahora</button>
        </div>
        <div class="dish-list" id="available-dishes"></div>
      </section>

      <section class="section gallery-section" id="galeria" aria-labelledby="gallery-title">
        <div class="section-heading">
          <p>Galería</p>
          <h2 id="gallery-title">Campo, cocina y sobremesa</h2>
        </div>
        <div class="gallery-grid">
          ${content.gallery
            .map((item, index) => `<figure class="gallery-card tone-${index + 1}"><figcaption>${item}</figcaption></figure>`)
            .join('')}
        </div>
      </section>

      <section class="section event-section" id="eventos" aria-labelledby="events-title">
        <p>Eventos</p>
        <h2 id="events-title">Celebraciones con sabor de campo.</h2>
        <button class="secondary-action dark" type="button" data-open-reservation>Consultar una fecha</button>
      </section>
    </main>

    <footer class="site-footer" id="contacto">
      <div>
        <strong>${content.brand}</strong>
        <span>${content.address}</span>
      </div>
      <div>
        <a href="tel:${content.phone.replaceAll(' ', '')}">${content.phone}</a>
        <a href="mailto:${content.email}">${content.email}</a>
        <a href="/admin">Panel del dueño</a>
      </div>
    </footer>

    <dialog class="reservation-modal" id="reservation-modal" aria-labelledby="reservation-title">
      <div class="modal-shell">
        <button class="modal-close" type="button" aria-label="Cerrar reserva" data-close-reservation>x</button>
        <div class="modal-intro">
          <p>Reserva online</p>
          <h2 id="reservation-title">Asegura tu mesa</h2>
          <span>Recibirás una confirmación por correo. La tolerancia sugerida es de 15 minutos.</span>
        </div>
        <form class="form-grid" id="reservation-form">
          <label class="field">
            <span>Nombre</span>
            <input name="name" required autocomplete="name" />
          </label>
          <label class="field">
            <span>Correo</span>
            <input name="email" type="email" required autocomplete="email" />
          </label>
          <label class="field">
            <span>Celular</span>
            <input name="phone" required autocomplete="tel" />
          </label>
          <label class="field">
            <span>Fecha</span>
            <input name="date" type="date" required value="${today()}" />
          </label>
          <label class="field">
            <span>Hora</span>
            <input name="time" type="time" required value="13:00" />
          </label>
          <label class="field">
            <span>Personas</span>
            <input name="guests" type="number" min="1" required value="2" />
          </label>
          <label class="field field-wide">
            <span>Notas</span>
            <textarea name="notes" rows="4"></textarea>
          </label>
          <button class="primary-action" type="submit">Confirmar reserva</button>
          <p class="form-status" id="reservation-status" role="status"></p>
        </form>
      </div>
    </dialog>
  `;

  const dateInput = root.querySelector('#availability-date');
  const dishesNode = root.querySelector('#available-dishes');
  const reservationForm = root.querySelector('#reservation-form');
  const statusNode = root.querySelector('#reservation-status');
  const modal = root.querySelector('#reservation-modal');
  const reservationDate = reservationForm.elements.date;

  async function loadAvailableDishes() {
    dishesNode.innerHTML = '<p class="muted">Cargando platos...</p>';
    const dishes = await api.getAvailability(dateInput.value);
    dishesNode.innerHTML = dishes.length
      ? dishes
          .map(
            (dish) => `
              <article class="menu-item compact">
                <span>${escapeHtml(dish.category)}</span>
                <div>
                  <h3>${escapeHtml(dish.name)}</h3>
                  <p>${escapeHtml(dish.description)}</p>
                </div>
                <strong>${formatPrice(dish.price)}</strong>
              </article>
            `
          )
          .join('')
      : '<p class="muted">Todavía no hay platos asignados para esta fecha.</p>';
  }

  dateInput.addEventListener('change', () => {
    reservationDate.value = dateInput.value;
    loadAvailableDishes();
  });
  await loadAvailableDishes();

  root.querySelectorAll('[data-open-reservation]').forEach((button) => {
    button.addEventListener('click', () => {
      reservationDate.value = dateInput.value;
      modal.showModal();
    });
  });

  root.querySelector('[data-close-reservation]').addEventListener('click', () => modal.close());

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.close();
    }
  });

  reservationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    statusNode.textContent = 'Enviando reserva...';

    try {
      const payload = Object.fromEntries(new FormData(reservationForm));
      const reservation = await api.createReservation(payload);
      const emailMessage = {
        sent: 'Correo de confirmacion enviado.',
        failed: 'No se pudo enviar el correo de confirmacion; tu reserva si quedo registrada.',
        simulated: 'Reserva registrada. El correo quedo en modo simulado.'
      }[reservation.emailDeliveryStatus] || 'Reserva registrada.';

      statusNode.textContent = `Reserva confirmada para ${reservation.date} a las ${reservation.time}. ${emailMessage}`;
      reservationForm.reset();
      reservationDate.value = dateInput.value;
    } catch (error) {
      statusNode.textContent = error.message;
    }
  });
}
