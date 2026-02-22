# Gitloops

A plugin for [OpenCode](https://opencode.ai) that lets you clone and explore any public GitHub repository locally. Ask questions about a repo's code, structure, and patterns — all without leaving your terminal.

Gitloops registers a read-only agent with three custom tools (`gitloops_clone`, `gitloops_refresh`, `gitloops_list`) and restricts itself to `read`, `grep`, `glob`, and `list` — no file modifications, no shell access.

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
  "eviction_strategy": "lru"
}
```

| Option              | Type      | Default                   | Description                                                                            |
| ------------------- | --------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `max_repos`         | `integer` | `10`                      | Maximum number of cached repos. When exceeded, repos are evicted automatically.        |
| `cache_loc`         | `string`  | `~/.cache/gitloops/repos` | Directory where cloned repos are stored (`<cache_loc>/<owner>/<repo>/`). Supports `~`. |
| `eviction_strategy` | `string`  | `"lru"`                   | Strategy for removing repos when `max_repos` is exceeded.                              |

### Eviction strategies

| Strategy  | Behavior                                                       |
| --------- | -------------------------------------------------------------- |
| `lru`     | Remove the least recently used repo (oldest modification time) |
| `fifo`    | Remove the oldest cloned repo (oldest creation time)           |
| `largest` | Remove the largest repo by disk size                           |

The `$schema` field enables autocompletion and validation in editors that support JSON Schema.
