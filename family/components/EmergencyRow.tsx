import Link from "next/link";
import { Icon } from "./Icon";

/** A calm way to the emergency card. Visible, not alarming. */
export function EmergencyRow({ lang = "en" }: { lang?: "en" | "ar" | "ru" }) {
  const label = { en: "Emergency numbers", ar: "أرقام الطوارئ", ru: "Экстренные номера" }[lang];
  return (
    <Link href="/baby/emergency" className="row-link card-flat flex items-center gap-3">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
        <Icon name="phone" size={18} />
      </span>
      <span className="flex-1 font-semibold">{label}</span>
      <Icon name="forward" size={18} className="muted" />
    </Link>
  );
}
