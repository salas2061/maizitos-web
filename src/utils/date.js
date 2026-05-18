export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function formatPrice(value) {
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN'
  }).format(value);
}
