import {
  FaFacebookF,
  FaInstagram,
  FaTelegram,
  FaWhatsapp,
  FaXTwitter,
} from "react-icons/fa6";
import { brand, socialLinks } from "@/config/brand";

const icons = {
  whatsapp: FaWhatsapp,
  telegram: FaTelegram,
  facebook: FaFacebookF,
  x: FaXTwitter,
  instagram: FaInstagram,
} as const;

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={`site-footer${compact ? " site-footer-compact" : ""}`}>
      <div>
        <strong>برمجة وتطوير {brand.developer}</strong>
        <span>{brand.copyrightYear}</span>
      </div>
      <nav className="social-links" aria-label="حسابات التواصل الاجتماعي">
        {socialLinks.map((item) => {
          const Icon = icons[item.id];
          const content = <><Icon aria-hidden="true" /><span className="sr-only">{item.label}</span></>;
          return item.href ? (
            <a key={item.id} className="social-link" href={item.href} target="_blank" rel="noreferrer" aria-label={item.label}>
              {content}
            </a>
          ) : (
            <span key={item.id} className="social-link social-link-disabled" aria-label={`${item.label} — الرابط غير مضاف بعد`} role="img">
              {content}
            </span>
          );
        })}
      </nav>
    </footer>
  );
}
