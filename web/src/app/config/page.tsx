import { ConfigForm } from "@/components/config-form";
import { MobileSettingsExtras } from "@/components/mobile/mobile-settings-extras";
import { ApiKeySettings } from "@/components/auth/api-key-settings";

// Settings is the mobile app's catch-all surface (the prototype reaches it from
// the header, not the tab bar): the config form as on desktop, plus the
// destinations and the offline/data controls that the desktop sidebar provides
// and a five-item tab bar has no room for.
export default function ConfigPage() {
  return (
    <>
      <ConfigForm />
      {/* Same column width as ConfigForm's own inner wrapper, so this reads as
          part of the same page rather than a bolted-on afterthought. Renders
          nothing on a single-tenant install (no signed-in account to key on). */}
      <div className="mx-auto max-w-2xl px-6">
        <ApiKeySettings />
      </div>
      <div className="mx-auto max-w-3xl px-4 pb-8 sm:px-6">
        <MobileSettingsExtras />
      </div>
    </>
  );
}
