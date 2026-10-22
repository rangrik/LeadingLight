import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@leadinglight/ui/components/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@leadinglight/ui/components/card";
import { Input } from "@leadinglight/ui/components/input";

export default function App() {
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("");

  async function greet(e: React.FormEvent) {
    e.preventDefault();
    setGreeting(await invoke<string>("greet", { name }));
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>LeadingLight</CardTitle>
          <CardDescription>A space for life in general.</CardDescription>
        </CardHeader>
        <CardPanel>
          <form onSubmit={greet} className="flex gap-2">
            <Input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Button type="submit">Greet</Button>
          </form>
          {greeting && <p className="mt-4 text-sm text-muted-foreground">{greeting}</p>}
        </CardPanel>
      </Card>
    </main>
  );
}
