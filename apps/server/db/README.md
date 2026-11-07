# 数据库迁移

`migrations.json` 是执行顺序的唯一清单。SQL保留在现有位置，避免影响当前部署脚本。原生PostgreSQL和HTTP RPC使用同一套数据库结构，区别在服务端调用方式。

| 顺序 | 文件 | 内容 |
| --- | --- | --- |
| 001 | `apps/server/src/v2/schema.sql` | 房间、座位与创建/加入请求记录 |
| 002 | `apps/server/src/v2/rpc.sql` | 房间创建、加入和状态RPC函数 |
| 003 | `cloudbase/migrations/20261107160000_gameplay_transactions.sql` | 游戏状态、动作收据和游戏RPC函数 |
| 004 | `cloudbase/migrations/20261107160001_restrict_gameplay_rpc.sql` | 撤销默认客户端角色的函数执行权限 |

配置项目根目录 `.env` 的 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` 后执行 `npm run db:migrate`。这是数据库所有者执行的管理命令，与运行服务的RPC密钥分开配置。当前Docker镜像只运行API，迁移从仓库管理环境执行。

迁移器使用数据库锁串行执行，逐个事务提交，并记录SQL摘要。再次执行会跳过已记录的迁移，修改已经应用的SQL会报错。后续结构变化追加新SQL和新清单项。

首次采用此迁移器时，适用于新数据库。已经手动执行过上述SQL的数据库需要先核对结构并建立基线记录，尤其003不能重复建表。先备份并在测试副本核验，禁止通过清库解决迁移冲突。

本地 `npm run test:db` 使用临时PostgreSQL执行同一清单，并重复执行一次验证幂等，随后运行数据库与HTTP测试。测试不会连接 `.env` 的正式数据库。
