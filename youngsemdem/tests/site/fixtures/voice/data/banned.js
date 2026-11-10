/* Voice lint fixture: bilingual data with seeded problems. The `never` list must be skipped. */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.banned = {
  items: [
    { id: 'a', title: { en: 'Join the chat', es: 'Únete al chat' } },
    { id: 'b', title: { en: 'Open to ages 40 and under', es: 'Para personas de 40 o menos' } },
    { id: 'c', body: { en: 'Every mail ballot request expires Dec 31.', es: 'Cada solicitud de boleta vence el 31 de diciembre.' } },
    { id: 'd', body: { en: 'Earn XP and level up.', es: 'Gana XP y sube de nivel.' } },
    { id: 'e', body: { en: 'Hi! Come! Now!', es: '¡Hola! ¡Ven! ¡Ya!' } }
  ],
  debrief: { tone: 'serious', body: { en: 'We lost the state. Get back up!', es: 'Perdimos el estado. ¡Arriba!' } },
  // sources[].name is a proper title (skipped); the rest of a sources entry and a "sources" label are linted
  facts: [{ claim: { en: 'Rent went up again.', es: 'La renta volvió a subir.' }, sources: [
    { url: 'https://example.org/report', name: { en: 'Join the chat: a 2024 report', es: 'Únete al chat: informe de 2024' }, label: { en: 'Join the chat', es: 'Únete al chat' } }
  ] }],
  labels: { sources: { en: 'Sources to join the chat', es: 'Fuentes para unirte al chat' } },
  never: [{ en: 'slay', es: 'guerrero' }, { en: 'FINAL NOTICE', es: 'último aviso' }],
  source: 'https://example.org/trump-desantis-article',
  note: 'Editors only: Jolly and Donalds are named here on purpose; notes are skipped.'
};
