# Execução local

Node 24.19 ou superior da série 24, Docker e PostgreSQL 16.15 Alpine fixado por digest. Somente dados sintéticos. Não usar banco, credenciais ou volume do SystemOS.

1. Execute `npm ci --ignore-scripts` e `npm run local:setup`. O gerador recusa sobrescrever configuração existente. Segredos ficam em `.local/`, ignorado pelo Git; nunca copie seu conteúdo para logs ou tickets. Em Windows, restrinja o diretório ao usuário e SYSTEM por ACL. Em Linux, arquivos são criados com modo 0600.
2. Inicie o PostgreSQL com `docker compose -f compose.local.yaml up -d --wait`. Porta 55439 em loopback, container e volume exclusivos deste projeto. A imagem é fixada por digest; sua atualização precisa de revisão e novos testes.
3. Execute `npm run local:bootstrap`. Aplica migrações com credencial de migração, cria o papel runtime restrito e o banco `ligado_pay_test` separado.
4. Execute `npm test`, `npm run test:integration`, `npm run contract:check`, `npm run local:verify` e `npm audit`. Testes de integração recusam host remoto ou banco com outro nome. Alteram apenas dados sintéticos no banco de teste; requerem identidade administrativa desse banco para os testes de falha transacional. A verificação local abre a API temporariamente e cria uma cobrança simulada no banco local usando o papel runtime restrito; encerra a API ao terminar.
5. Em PowerShell: `$env:LIGADO_PAY_CONFIG_FILE = (Resolve-Path '.local/runtime.json').Path`; depois `npm start`. API em `127.0.0.1:3305`, sem exposição pública. Não definir NODE_ENV=production com essa configuração local. O modo publicado `private-production` exige NODE_ENV=production, identidade e configuração operacionais próprias; consulte [produção privada](PRODUCAO_PRIVADA.md).
6. Para parar o banco local use `docker compose -f compose.local.yaml stop`. Não remover volumes sem intenção explícita de apagar os dados de desenvolvimento.

## API de desenvolvimento

- `GET /health/live`: apenas vida do processo; não consulta banco.
- `GET /health/ready`: requer autenticação, verifica tabelas e informa modo simulado.
- `POST /v1/payments`: requer `Authorization: Bearer <token-local>` e `Idempotency-Key` com 16 a 100 caracteres alfanuméricos, hífen ou underscore.
- `GET /v1/payments/<uuid>`: requer autenticação e permissão de leitura; outro aplicativo/recebedor recebe 404.

Exemplo de corpo sintético, sem credenciais:

```json
{
  "receiverId": "ligado-local",
  "externalReference": "opaque-demo-001",
  "amountCents": 1500,
  "currency": "BRL",
  "method": "pix"
}
```

O token está no arquivo privado `.local/client.json`; o hash está na configuração runtime. Uma resposta simulada nunca deve liberar serviço ou representar dinheiro recebido. Não há QR de demonstração que possa ser confundido com cobrança real.

`PROCESSING` significa reserva durável aguardando resultado. `PENDING` indica aceitação pelo simulador. `UNCERTAIN` indica falha sem prova de que a operação externa não ocorreu. Repetição com mesma chave/conteúdo devolve o mesmo identificador; alteração de conteúdo ou outra chave para a mesma referência retorna 409.

## Preparação da InfinitePay no Windows

Primeiro atualize o banco local com `npm run local:bootstrap`. Para guardar a chave real sem enviá-la ao chat, execute pessoalmente no PowerShell:

```powershell
& .\scripts\guardar-chave-infinitepay.ps1
```

A entrada é oculta. O comando não inicia a API nem se conecta à InfinitePay. O arquivo cifrado fica em `%LOCALAPPDATA%\LigadoTattoo\LigadoPay\infinitepay.dpapi`, restrito ao usuário e SYSTEM. Em 26/10/2026, a chave fornecida localmente pelo usuário foi cifrada por esse helper, o arquivo de entrada foi removido e a leitura protegida pelo runtime foi confirmada sem exibir o valor. A autenticação junto ao provedor ainda não foi testada.

Para preparar a configuração, após informar a InfiniteTag correta e uma rota HTTPS de retorno sob controle da Ligado:

```powershell
npm run build
node scripts/prepare-infinitepay.mjs --handle SUA_INFINITETAG --redirect https://SEU_DOMINIO/retorno-pagamento
```

Isso cria `.local/infinitepay.runtime.json` sem sobrescrever a configuração anterior e com `liveCreationEnabled=false`. Não informa a chave como argumento e não faz chamadas externas. A rota de retorno deve existir na aplicação integradora antes de qualquer uso real; ela não confirma pagamento por conta própria.

Selecionar essa configuração via `LIGADO_PAY_CONFIG_FILE` monta o conector local. A API ainda fica em loopback. Produção de infraestrutura (`NODE_ENV=production`) permanece recusada. `environment=production` na configuração se refere à conta/endpoint financeiro real da InfinitePay, não a uma declaração de implantação pronta.

`npm run infinitepay:verify` usa uma credencial sintética temporária e bloqueia toda saída de rede do processo da API. Comprova composição, segredo protegido e bloqueio de criação real; não usa sua chave e não cria cobrança. Os testes de integração cobrem criação/consulta/confirmação com transporte sintético e banco real.

Para conferir um retorno autorizado, o backend integrador chama `POST /v1/payments/<uuid>/check` com token de serviço e corpo `{ "orderNsu": "<uuid-da-cobranca>", "transactionNsu": "<uuid-da-transacao>", "slug": "<codigo>" }`. Valores, recebedor, estado e credenciais não são aceitos nesse corpo. Um retorno do navegador nunca deve alterar a OS antes dessa consulta validada.

Não alterar o switch de criação antes de apresentar o teste real concreto ao usuário. Estornos, dispatcher de eventos e a integração das telas do SystemOS/portal/app ainda estão pendentes.
