import { AssistantConsole } from "@/components/assistant-console";

// The Agent route from the PWA prototype: "natural language in, components out".
// On mobile this is a tab of its own rather than a bubble floating over whatever
// you were reading; on desktop the docked console in the app shell is still the
// primary way in, and this route is simply a full-width version of it.
export const dynamic = "force-dynamic";

export const metadata = { title: "Agent — career-ops" };

export default function AgentPage() {
  return (
    <div className="co-surface mx-auto max-w-3xl px-3.5 py-3 md:px-6 md:py-8">
      <AssistantConsole variant="page" />
    </div>
  );
}
