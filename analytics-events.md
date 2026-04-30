# Website Events

| Event                  | Properties                                                                       | Where                  |
| ---------------------- | -------------------------------------------------------------------------------- | ---------------------- |
| `download_app_clicked` | `surface: "website"`, `app_version`, `button_location: "nav" \| "hero" \| "cta"` | three download buttons |
| `github_clicked`       | `surface: "website"`, `app_version`, `button_location: "nav" \| "hero" \| "cta"` | three GitHub buttons   |

The footer GitHub link is no longer tracked.

# Desktop Events

Desktop events are identified with a random install ID stored in Electron user data unless private mode is on.

| Event                        | Properties                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| `branches_pushed`            | `surface`, `app_version`, `change_count`                                   |
| `branches_pulled`            | `surface`, `app_version`, `change_count`                                   |
| `branch_dragged`             | `surface`, `app_version`                                                   |
| `branch_moved`               | `surface`, `app_version`, `had_warning`                                    |
| `branch_deleted`             | `surface`, `app_version`, `had_warning`                                    |
| `tag_deleted`                | `surface`, `app_version`, `had_warning`                                    |
| `branch_created`             | `surface`, `app_version`, `target_type`                                    |
| `tag_created`                | `surface`, `app_version`, `target_type`                                    |
| `changes_committed`          | `surface`, `app_version`, `did_move_branch`                                |
| `branch_merged`              | `surface`, `app_version`, `added_lines`, `removed_lines`, `conflict_count` |
| `head_switched`              | `surface`, `app_version`, `target_type`                                    |
| `repo_opened`                | `surface`, `app_version`, `launcher`, `source`                             |
| `repo_selected`              | `surface`, `app_version`                                                   |
| `path_launcher_changed`      | `surface`, `app_version`, `launcher`                                       |
| `chat_opened`                | `surface`, `app_version`                                                   |
| `change_summary_opened`      | `surface`, `app_version`                                                   |
| `codex_chats_filter_changed` | `surface`, `app_version`, `is_enabled`                                     |
| `github_clicked`             | `surface`, `app_version`, `button_location: "settings"`                    |
