# Gitloops

A plugin for [OpenCode](https://opencode.ai) that lets you clone and explore GitHub repositories locally. Ask questions about a repo's code, structure, and patterns — all without leaving your terminal.

Gitloops provides three custom tools (`gitloops_clone`, `gitloops_refresh`, `gitloops_list`) restricted to read operations — no file modifications, no shell access. You can use these tools from any agent, or optionally enable a dedicated `gitloops` agent via config.

## Installation

Add the plugin to your `opencode.json` config file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-gitloops"]
}
```

OpenCode will automatically install the package.

Alternatively, you can install it as a local plugin by placing it in your plugin directory:

- **Project-level:** `.opencode/plugins/`
- **Global:** `~/.config/opencode/plugins/`

## Configuration

Gitloops auto-creates a config file on first load at:

```
~/.config/opencode/plugin/gitloops.json
```

```json
{
  "$schema": "https://raw.githubusercontent.com/maharshi365/opencode-gitloops/master/schema/config.schema.json",
  "max_repos": 10,
  "cache_loc": "~/.cache/gitloops/repos",
  "eviction_strategy": "lru",
  "register_agent": false
}
```

| Option              | Type      | Default                   | Description                                                                            |
| ------------------- | --------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `max_repos`         | `integer` | `10`                      | Maximum number of cached repos. When exceeded, repos are evicted automatically.        |
| `cache_loc`         | `string`  | `~/.cache/gitloops/repos` | Directory where cloned repos are stored (`<cache_loc>/<owner>/<repo>/`). Supports `~`. |
| `eviction_strategy` | `string`  | `"lru"`                   | Strategy for removing repos when `max_repos` is exceeded.                              |
| `register_agent`    | `boolean` | `false`                   | When `true`, adds a dedicated `gitloops` agent to the OpenCode agent picker. When `false` (default), only the tools are registered — use them from any agent or your own custom agent. |

### Eviction strategies

| Strategy  | Behavior                                                       |
| --------- | -------------------------------------------------------------- |
| `lru`     | Remove the least recently used repo (oldest modification time) |
| `fifo`    | Remove the oldest cloned repo (oldest creation time)           |
| `largest` | Remove the largest repo by disk size                           |

The `$schema` field enables autocompletion and validation in editors that support JSON Schema.

### Agent registration

By default (`register_agent: false`) Gitloops only registers its tools. This is useful when you want to call `gitloops_clone`, `gitloops_refresh`, and `gitloops_list` from your own custom agent or the default assistant.

Set `register_agent: true` to also add a dedicated read-only `gitloops` agent to the OpenCode agent picker.

### Private repositories

Private repositories are supported as long as your local git credentials or SSH keys grant access — the same way `git clone` works in your terminal. No additional configuration is needed.

If a clone fails due to missing credentials, Gitloops will surface a specific error message directing you to configure your git credentials or SSH keys.
