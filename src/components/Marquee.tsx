import { Cable, Cloud, Cpu, FileText, FolderSync, Globe2, HardDrive, Radio, ShieldCheck, Users } from "lucide-react";

const items = [
  { icon: Globe2, label: "WebRTC mesh" },
  { icon: ShieldCheck, label: "E2E encrypted" },
  { icon: FolderSync, label: "Folder sync" },
  { icon: Cable, label: "WebSockets" },
  { icon: Cpu, label: "Edge relay" },
  { icon: HardDrive, label: "Cloud overflow" },
  { icon: Users, label: "100+ peers" },
  { icon: Radio, label: "Sub-50ms chat" },
  { icon: FileText, label: "Live cursors" },
  { icon: Cloud, label: "TUS resumable" },
];

export function Marquee() {
  const doubled = [...items, ...items];
  return (
    <div className="marquee-wrap">
      <div className="marquee">
        <div className="marquee-track">
          {doubled.map((item, i) => (
            <div className="marquee-item" key={i}>
              <item.icon size={15} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
