/* Fixture config for tests/site (make_es): only the keys the tools read. */
window.YSD_CONFIG = Object.assign({
  demo: true,
  site: { url: '' },
  links: { vote: { countyPhone: '407-585-8683' } },
  legal: { cardFooter: 'Paid for by [committee name and address placeholder] · DEMO' }
}, window.YSD_CONFIG || {});
