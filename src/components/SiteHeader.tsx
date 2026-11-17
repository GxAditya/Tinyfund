import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Code, Coin, Key, MagnifyingGlass, SidebarSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { loadKeys, loadRuns, saveKeys, useKeys, type RunRecord } from "@/lib/tinyfund/store";
import type { Keys } from "@/lib/tinyfund/types";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_FREE = "openrouter/free";
const PRESETS = [
  { name: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  { name: "Claude", base: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
  { name: "Grok", base: "https://api.x.ai/v1", model: "grok-4-fast" },
  { name: "Groq (free)", base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { name: "Gemini (free)", base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
  { name: "OpenRouter", base: OPENROUTER_BASE, model: OPENROUTER_FREE },
];

export function SettingsDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [k, setK] = useState<Keys>({});
  useEffect(() => {
    if (open) setK(loadKeys());
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Key weight="bold" /> Keys
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Your API keys</DialogTitle>
          <DialogDescription>Stored only in this browser and sent with each request you make.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>TinyFish API key (required)</Label>
            <Input type="password" value={k.tinyfishKey ?? ""} onChange={(e) => setK({ ...k, tinyfishKey: e.target.value })} placeholder="sk-tinyfish-…" />
            <p className="text-xs text-muted-foreground">Use a personal key: TinySet refuses organization keys.</p>
          </div>
          <div className="rule-dash pt-4 space-y-3">
            <p className="text-sm font-medium">AI model (optional): OpenAI, Claude, Grok, or any OpenAI-compatible provider</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button key={p.name} type="button" variant="secondary" size="sm" onClick={() => setK({ ...k, aiBaseUrl: p.base, aiModel: p.model })}>
                  {p.name}
                </Button>
              ))}
            </div>
            <Input value={k.aiBaseUrl ?? ""} onChange={(e) => setK({ ...k, aiBaseUrl: e.target.value })} placeholder="Base URL" />
            {k.aiBaseUrl?.includes("openrouter.ai") && (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Use free models</p>
                  <p className="text-xs text-muted-foreground">OpenRouter picks an available free model for you.</p>
                </div>
                <Switch
                  checked={k.aiModel === OPENROUTER_FREE}
                  onCheckedChange={(on) => setK({ ...k, aiModel: on ? OPENROUTER_FREE : "" })}
                />
              </div>
            )}
            <Input disabled={k.aiModel === OPENROUTER_FREE && !!k.aiBaseUrl?.includes("openrouter.ai")} value={k.aiModel ?? ""} onChange={(e) => setK({ ...k, aiModel: e.target.value })} placeholder="Model" />
            <Input type="password" value={k.aiKey ?? ""} onChange={(e) => setK({ ...k, aiKey: e.target.value })} placeholder="AI API key" />
          </div>
          <Button className="w-full" onClick={() => { saveKeys(k); setOpen(false); }}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NavItem({ to, icon: Icon, label }: { to: "/" | "/api-docs"; icon: typeof MagnifyingGlass; label: string }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      activeProps={{ className: "bg-sidebar-accent font-medium text-sidebar-accent-foreground" }}
    >
      <Icon className="size-4" weight="bold" /> {label}
    </Link>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
        <Coin className="size-4" weight="bold" />
      </span>
      <span className="font-display text-2xl tracking-tight">TinyFund</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const keys = useKeys();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setRuns(loadRuns()), [location.pathname]);
  const status = (
    <div className="rounded-lg border border-sidebar-border bg-card p-3">
      <div className={`flex items-center gap-2 text-xs font-medium ${keys.tinyfishKey ? "text-verified" : "text-destructive"}`}>
        <span className="size-1.5 rounded-full bg-current" />
        {keys.tinyfishKey ? "TinyFish connected" : "No TinyFish key"}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{keys.aiKey ? `AI: ${keys.aiModel}` : "AI: rule-based (optional)"}</p>
      <div className="mt-3">
        <SettingsDialog
          trigger={
            <Button variant="outline" size="sm" className="w-full">
              <Key weight="bold" /> Manage keys
            </Button>
          }
        />
      </div>
    </div>
  );
  return (
    <div className="flex min-h-screen">
      {collapsed && (
        <div className="sticky top-0 hidden h-screen shrink-0 border-r border-sidebar-border bg-sidebar p-3 md:block">
          <button onClick={() => setCollapsed(false)} aria-label="Open side panel" className="grid size-8 place-items-center rounded-md hover:bg-sidebar-accent">
            <SidebarSimple className="size-4" weight="bold" />
          </button>
        </div>
      )}
      <aside className={`sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 ${collapsed ? "" : "md:flex"}`}>
        <div className="flex items-center justify-between">
          <Brand />
          <button onClick={() => setCollapsed(true)} aria-label="Collapse side panel" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            <SidebarSimple className="size-4" weight="bold" />
          </button>
        </div>
        <nav className="space-y-0.5">
          <NavItem to="/" icon={MagnifyingGlass} label="New search" />
          <NavItem to="/api-docs" icon={Code} label="API" />
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="px-3 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Recent searches</p>
          {runs.length === 0 && <p className="px-3 pt-2 text-xs text-muted-foreground">Nothing yet.</p>}
          <ul className="mt-2 space-y-1">
            {runs.map((r) => (
              <li key={r.datasetId}>
                <Link
                  to="/run/$datasetId"
                  params={{ datasetId: r.datasetId }}
                  className="block rounded-md px-3 py-2 hover:bg-sidebar-accent"
                  activeProps={{ className: "bg-sidebar-accent" }}
                >
                  <span className="line-clamp-1 text-sm">{r.profile.description}</span>
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className={`size-1.5 rounded-full ${r.phase === "done" ? "bg-verified" : "bg-primary"}`} />
                    {r.profile.country} · {r.phase === "done" ? `${r.report?.investors.length ?? 0} investors` : r.phase}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        {status}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-sidebar px-4 py-3 md:hidden">
          <Brand />
          <div className="flex gap-2">
            <Link to="/api-docs" className="text-sm text-muted-foreground">API</Link>
            <SettingsDialog />
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
