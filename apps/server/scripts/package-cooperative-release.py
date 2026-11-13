from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import subprocess
root=Path(__file__).resolve().parents[3]
out=root/'.runtime/cooperative-release'
(root/'.runtime/deploy').mkdir(parents=True,exist_ok=True)
files=['package.json','package-lock.json','apps/server/package.json','apps/web/package.json']
files+=subprocess.check_output(['git','ls-tree','-r','--name-only','5fcfc84','apps/server/src'],text=True).splitlines()
for name in files:
 p=out/name;p.parent.mkdir(parents=True,exist_ok=True)
 p.write_bytes(subprocess.check_output(['git','show',f'5fcfc84:{name}']))
for name in ['cooperative.js','cooperative-layout.js','cooperative-assets.js']:
 (out/'apps/server/src/v2'/name).write_bytes((root/'apps/server/src/v2'/name).read_bytes())
for name in ['public/games/cooperative.html','src/games/cooperative.js','src/games/cooperative.css','src/state/storage.js','src/components/dom.js']:
 p=out/'apps/web'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((root/'apps/web'/name).read_bytes())
# Freeze existing production gameplay and provide a reward-capable store only to cooperative routes.
(out/'apps/server/src/v2/cooperative-store.js').write_text('''import { createHash } from 'node:crypto';
export function cooperativeStore(rooms) {
  return {
    enter: (...args) => rooms.enter(...args),
    loadGame: (...args) => rooms.loadGame(...args),
    commitGame(document, token, rewards, requestId, payload) {
      const digest = createHash('sha256').update(token).digest('hex');
      if (typeof rooms.call === 'function') {
        return rooms.call('anxian_game_reward_commit', {
          p_room: document.id, p_token_hash: digest, p_version: document.version,
          p_state: document.state, p_rewards: rewards,
          p_request_id: requestId ?? null, p_payload: payload ?? null,
        });
      }
      return rooms.gameQuery('SELECT public.anxian_game_reward_commit($1,$2,$3,$4,$5,$6,$7) AS result',
        [document.id, digest, document.version, JSON.stringify(document.state), JSON.stringify(rewards), requestId ?? null, payload ?? null]);
    },
  };
}
''')
# Current server only adds cooperative routes and static assets to the production router.
s=(root/'apps/server/src/v2/server.js').read_text()
s=s.replace("import { CooperativeService } from './cooperative.js';", "import { CooperativeService } from './cooperative.js';\nimport { cooperativeStore } from './cooperative-store.js';")
s=s.replace('new CooperativeService(service.rooms)', 'new CooperativeService(cooperativeStore(service.rooms))')
(out/'apps/server/src/v2/server.js').write_text(s)
(out/'Dockerfile').write_text('''FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node apps/server/src ./apps/server/src
COPY --chown=node:node apps/web ./apps/web
USER node
ENV HOST=0.0.0.0 PORT=3000 STORAGE_MODE=rpc
EXPOSE 3000
CMD ["node", "apps/server/src/v2/index.js"]
''')
with ZipFile(root/'.runtime/deploy/anxian-cooperative-release.zip','w',ZIP_DEFLATED) as z:
 for p in sorted(out.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(out))
print('Deployment package ready. Production gameplay baseline 5fcfc84; cooperative assets and routes added.')
