#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v docker >/dev/null || { printf 'Installez Docker Engine et le plugin Compose. Voir INSTALLATION_LOCALE.md.\n'; exit 1; }
docker compose version >/dev/null
if [[ ! -f "$HERE/.env" ]]; then
  umask 077
  password="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  template="$(< "$HERE/.env.example")"
  printf '%s\n' "${template/CHANGE_ME/$password}" > "$HERE/.env"
  printf 'Configuration locale créée dans installation/.env (mot de passe unique).\n'
  printf 'Lisez INSTALLATION_LOCALE.md pour configurer le réseau de la VM et le certificat.\n'
fi
if grep -q 'MONGO_PASSWORD=CHANGE_ME' "$HERE/.env"; then
  printf 'Remplacez CHANGE_ME par un mot de passe aléatoire dans installation/.env.\n'; exit 1
fi
if [[ "${1:-}" == "--configure-only" ]]; then
  printf 'Configuration prête. Modifiez installation/.env puis relancez sans --configure-only.\n'
  exit 0
fi
docker compose --env-file "$HERE/.env" -f "$HERE/compose.yaml" up -d --build --wait --wait-timeout 180
printf 'Services démarrés. Configurez le nom local et faites confiance au certificat avant installation dans le navigateur.\n'