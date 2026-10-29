> Atualização de 29/10/2026: consulte o [estado consolidado](ESTADO_ATUAL.md). Os marcos datados abaixo são históricos; não representam, por si só, a versão ativa, a instalação atual ou novas validações.

# Produção privada — implementação de 27/10/2026

## Contrato de inicialização

O gateway aceita `mode: "private-production"`, `provider: "infinitepay"` e
`environment: "production"` exclusivamente com `NODE_ENV=production`.
`mode: "local"` continua compatível com a implantação anterior em development,
mas é recusado em NODE_ENV=production. O simulador permanece local/sandbox.

O modo de execução não muda applicationId, receiverId, handle, referências,
hashes de autenticação, limites, criação habilitada ou histórico financeiro.
A configuração exige banco loopback, credenciais e conta vinculada; o entrypoint
continua verificando papel PostgreSQL sem superuser/createdb/createrole/bypassrls,
carregando segredos protegidos e escutando somente em 127.0.0.1.

Configuração com webhook exige arquivo da chave do proxy. A fábrica HTTP também
recusa notificações sem uma chave válida, mesmo se usada fora de main.ts.
HMAC autentica o encaminhamento SystemOS→gateway; não é assinatura InfinitePay.
Somente consulta autenticada ao provedor, vinculada à cobrança, confirma pagamento.

## Validação e situação da implantação

33 testes unitários e 25 testes PostgreSQL integrados passaram. Cobrem modos
incompatíveis, conta divergente, proxy ausente/assinatura inválida/expirada,
persistência antes de ACK, concorrência, idempotência e confirmação sintética.
Nenhum pagamento real ou consulta externa foi realizado.

Publicado em 27/10/2026. Release ativa:
`release-a24607afec584f19a321546d34f8b3e1`, mantendo o build API/Web
`87b40668-f6f2-482d-b11c-9efeaa225a46`. Manifesto completo do gateway:
`fe8c1e8e0038354545030715a9b0a627f096c15971599817cf56f02e00d70fbb`.

O publicador exige hash explícito para atualizar o gateway; sem ele, mantém o
bloqueio anterior contra diferenças. O hash cobre dist, dependências, contratos e
package.json. A troca aplica mode=private-production nas configurações do serviço
e de recuperação do operador, junto com nodeEnv=production no descritor.
Credenciais DPAPI e identidades financeiras foram preservadas. Recuperação
administrativa protegida: publication-f8ff8af2187342d18daf4d72ce01d36c.

Processos sob as identidades previstas, listeners loopback e versão pública foram
verificados. /health/ready autenticado confirmou produção privada e banco pronto.
Os testes sintéticos cobriram quatro falhas com recuperação conjunta de código,
configuração, descritor e cópia do operador. Não houve falha real de produção para
exercitar rollback durante essa atualização.

Backup posterior passou (77 tabelas/192 objetos, mais banco do gateway). A retomada
dos escritores e a prontidão autenticada foram verificadas. Restauração isolada passou: 185.736 registros, hashes de dados/objetos e
sequências conferidos, incluindo o banco do gateway; produção não modificada. Sem mudança de schema nesta etapa.

Não há alteração de contrato para o portal ou Android nesta etapa, nem necessidade
de gerar um novo APK por esta mudança de configuração de servidor.

## Fechamento da etapa 2 — publicação e recuperação

Restauração de 27/10/2026 14:13:38 UTC passou com 77 tabelas, 185.736 registros,
192 objetos e banco do gateway. Hashes e sequências conferidos; produção intocada.
Cópia AES-256-GCM criada e verificada em
`../backups/systemos-ligado-pay-producao-privada-2026-10-27-141229.enc`
(relativo ao repositório SystemOS). Chave anterior preservada na pasta separada.
Upload externo manual continua pendente. Evidência sanitizada no SystemOS:
`evidencias/producao-privada-publicacao-2026-10-27.json`.
