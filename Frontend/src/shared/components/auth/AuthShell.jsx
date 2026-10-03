import logoImage from '@/assets/logo.png';
import '@/shared/styles/auth.css';

export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  brandHeadline = 'One app for food, mart & rides',
  brandLead = 'Sign in to order food and order food and book rides — all from Buddy Service.',
  brandFeatures = [],
  heroImage = null,
  services = null,
}) {
  return (
    <div className="auth-page">
      <div className="auth-page__grid">
        <aside className="auth-brand" aria-hidden={false}>
          <div className="auth-brand__glow auth-brand__glow--a" />
          <div className="auth-brand__glow auth-brand__glow--b" />

          <div className="auth-brand__content">
            <div className="auth-brand__logo-row">
              <img src={logoImage} alt="" className="auth-brand__logo" />
              <span className="auth-brand__name">Buddy Service</span>
            </div>

            <h1 className="auth-brand__headline">{brandHeadline}</h1>
            <p className="auth-brand__lead">{brandLead}</p>

            {brandFeatures.length > 0 && (
              <div className="auth-brand__features">
                {brandFeatures.map((item) => (
                  <div key={item.label} className="auth-brand__feature">
                    <span className="auth-brand__feature-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            )}

            {services ? <div className="auth-services lg:hidden">{services}</div> : null}
          </div>

          {heroImage ? (
            <img src={heroImage} alt="" className="auth-brand__hero-img hidden lg:block" />
          ) : null}

          {services ? <div className="auth-services hidden lg:grid">{services}</div> : null}
        </aside>

        <div className="auth-panel">
          <div className="auth-card">
            <div className="auth-mobile-brand">
              <img src={logoImage} alt="" className="auth-brand__logo" />
              <span className="auth-brand__name text-foreground">Buddy Service</span>
            </div>

            {eyebrow ? <p className="auth-eyebrow">{eyebrow}</p> : null}
            <h2 className="auth-title">{title}</h2>
            {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}

            {children}

            {footer ? <div className="auth-footer">{footer}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
