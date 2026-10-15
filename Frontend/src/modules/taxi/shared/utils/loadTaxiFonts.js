const FONT_LINK_ID = 'taxi-fonts';
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700;800;900&family=Outfit:wght@300;400;500;600;700;800;900&display=swap';

/** The taxi screens use Outfit / Inter / Plus Jakarta Sans; load them once, only when taxi opens. */
export const loadTaxiFonts = () => {
  if (typeof document === 'undefined' || document.getElementById(FONT_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  document.head.appendChild(link);
};
