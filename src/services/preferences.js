// Preferencias del panel de cada usuario (se guardan en su usuario, no en la cuenta de WhatsApp).
export const GROUPS_VIEWS = Object.freeze(['classic', 'modern']);

export function normalizePreferences(raw = {}) {
  return {
    // Ventana de Grupos: la clásica de siempre o la moderna.
    groupsView: GROUPS_VIEWS.includes(raw?.groupsView) ? raw.groupsView : 'classic',
  };
}
