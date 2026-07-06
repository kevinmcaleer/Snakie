An AI helper that lives next to your code — ask questions, generate MicroPython,
fix errors.

## Set it up (once)

The chat needs an API key for at least one provider:

1. Open **Settings ▸ Chat** (the gear, or the ⚙ in the chat panel).
2. Pick a provider — **Anthropic (Claude)**, **OpenAI**, **Grok**, or
   **GitHub Copilot** — and paste its API key (each has a "Get a key" link).
   Copilot signs in with a device code instead of a key.
3. Keys are stored encrypted on your machine and never leave it except to call
   the provider you chose.

## Using the chat

Open the chat panel (right side). Ask anything — "write MicroPython to sweep a
servo on GP15", "why does this traceback happen?", "explain PWM like I'm 10".
The chat can see your **active file**, so "find the bug in this" works. Code
blocks have a copy button; paste into the editor and run.

Switch provider/model from the dropdown in the chat footer at any time.

## Inline autocomplete

The same providers can power **inline code suggestions** in the editor
(ghost text as you type — <kbd>Tab</kbd> accepts). Turn it on and choose its
provider in **Settings ▸ Chat ▸ Autocomplete**. It's independent of the chat,
so you can use either without the other.

## No key?

Everything else in Snakie works without one — the chat panel is the only thing
that needs it. You can hide the panel with its knob in the toolbar.
