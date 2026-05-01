# Git Sync

## Branches

| State                   | Push                 | Revert               |
| ----------------------- | -------------------- | -------------------- |
| Local only              | Create on origin     | Delete local branch  |
| Origin only             | Delete from origin   | Create local branch  |
| Local and origin differ | Move origin to local | Move local to origin |
| Local and origin match  | Hidden               | Hidden               |

## Tags

| State                   | Push                         | Revert                       |
| ----------------------- | ---------------------------- | ---------------------------- |
| Local only              | Create on origin             | Delete local tag             |
| Origin only             | Auto-fetched locally; hidden | Auto-fetched locally; hidden |
| Local and origin differ | Move origin to local         | Move local to origin         |
| Local and origin match  | Hidden                       | Hidden                       |

## Fetch Rules

| Remote data                              | Local behavior                    |
| ---------------------------------------- | --------------------------------- |
| New origin branch                        | Keep as `origin/<branch>`         |
| New origin tag                           | Create local tag                  |
| Deleted origin branch                    | Keep local branch unless reverted |
| Deleted origin tag                       | Keep local tag unless reverted    |
| Moved origin tag with existing local tag | Show sync difference              |
