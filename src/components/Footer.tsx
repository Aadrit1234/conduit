import { useNavigate } from "react-router-dom";
import { Code2, Radio, AtSign, Globe } from "lucide-react";

const cols = [
  { title: "Product", links: ["Rooms", "File transfer", "Live data", "Pricing", "Changelog"] },
  { title: "Developers", links: ["Documentation", "API reference", "WebSocket protocol", "Status", "Open source"] },
  { title: "Company", links: ["About", "Security", "Privacy policy", "Terms", "Contact"] },
];

export function Footer() {
  const navigate = useNavigate();
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <div className="logo">
            <span className="logo-mark"><Radio size={17} /></span>
            <span className="logo-name">conduit</span>
          </div>
          <p>
            Real-time rooms for files, folders, data and chat — encrypted end to end,
            ephemeral when you want, permanent when you need.
          </p>
          <div className="footer-social">
            <a href="#top" aria-label="Source"><Code2 size={17} /></a>
            <a href="#top" aria-label="Social"><AtSign size={17} /></a>
            <a href="#top" aria-label="Website"><Globe size={17} /></a>
          </div>
        </div>
        {cols.map((c) => (
          <div className="footer-col" key={c.title}>
            <h4>{c.title}</h4>
            {c.links.map((l) => (
              <a key={l} href="#top">{l}</a>
            ))}
          </div>
        ))}
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} Conduit Labs — concept build.</span>
        <button className="footer-launch" onClick={() => navigate("/room")}>Launch a room →</button>
      </div>
    </footer>
  );
}
