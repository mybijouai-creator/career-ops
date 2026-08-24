import { ConfigForm } from "@/components/config-form";
import { MobileSettingsExtras } from "@/components/mobile/mobile-settings-extras";

// Settings is the mobile app's catch-all surface (the prototype reaches it from
// the header, not the tab bar): the config form as on desktop, plus the
// destinations and the offline/data controls that the desktop sidebar provides
// and a five-item tab bar has no room for.
export default function ConfigPage() {
  return (
    <>
      <ConfigForm />
      <div className="mx-auto max-w-3xl px-4 pb-8 sm:px-6">
        <MobileSettingsExtras />
      </div>
    </>
  );
}
