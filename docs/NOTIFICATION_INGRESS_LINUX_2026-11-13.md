# Notificações InfinitePay no Linux

O caminho público foi recuperado e verificado em **13/11/2026, 00h44 de São Paulo**, após corrigir uma falha de permissão introduzida na primeira publicação. O receptor dedicado usa a imagem `sha256:fc55f24105713525a434b6322c09cab87b33914d9fafef254b57ced0493adbf9` e mantém a URL já cadastrada no provedor: `/ligado-pay/webhooks/infinitepay` no domínio do SystemOS.

[Recibo sanitizado da publicação inicial, recuperação e provas públicas](NOTIFICATION_INGRESS_PUBLICACAO_2026-11-13.json). O estado final válido é `RECOVERED_AND_PUBLICLY_VERIFIED`; o sucesso registrado inicialmente não representava o acesso externo.

## Problema encontrado

A rota Next herdada do Windows tentava ler uma chave DPAPI e executar PowerShell, recursos ausentes no contêiner Linux. Um POST JSON vazio retornava 503. A contenção posterior também proibia que o frontend chamasse diretamente o gateway; liberar essa conexão não resolveria a leitura da chave Windows.

## Solução publicada

- Um receptor dedicado, `ligado-notification-ingress-1`, roda como UID 10009, com raiz somente leitura, capacidades removidas, limite de memória/processos e porta 3344 somente em loopback.
- Recebe **somente** a chave HMAC do encaminhamento. Não monta chave InfinitePay, tokens dos consumidores, credenciais de banco ou diretórios do SystemOS.
- O túnel encaminha apenas o caminho exato do webhook ao receptor. As rotas API, arquivos e portal foram mantidas. Nenhuma configuração foi alterada na conta InfinitePay.
- O receptor limita método, caminho, corpo, codificação, IP de origem e quantidade de requisições. Assina os metadados com HMAC para o verificador já existente do gateway. Não recebe destino configurável pelo cliente e não funciona como proxy de outras operações.
- O UID 10009 só pode iniciar TCP em 127.0.0.1:3305/3344. Bancos, storage, SSH, DNS e saída pública genérica continuam recusados. A web permanece sem acesso direto ao Pay.

A assinatura comprova o encaminhamento local, **não a autoria bancária**. Uma notificação continua sendo somente um aviso para reconsulta autenticada ao provedor. Não se alterou a regra que confirma pagamento.

## Falha da primeira publicação e recuperação

A primeira execução, às **22h52 de 12/11**, registrou sucesso com base na saúde local, mas substituiu o arquivo do túnel por outro pertencente a root, preservando apenas o modo 0600. O serviço `ligado-tunnel` perdeu a leitura do arquivo e entrou em reinício contínuo. O acesso público passou a mostrar a página de manutenção, apesar de API/web/Pay saudáveis no VPS. **Aquele recibo não comprovava a publicação pública e deve ser lido junto da recuperação posterior.**

Em 13/11 foi corrigido o proprietário do arquivo e reiniciado somente o conector. Portal e versão voltaram a retornar 200; consulta de OS sem sessão retornou 401. O webhook passou a alcançar o gateway, que recusou corretamente um corpo vazio com 400.

O publicador agora preserva **UID, GID e modo** na substituição atômica, valida a configuração como o próprio usuário do serviço e exige resposta 200 do endpoint de prontidão do túnel. A recuperação usa as mesmas verificações. Quatro testes de regressão Linux cobrem proprietário não-root/leitura real, identidade do validador, espera de prontidão e conector que nunca fica pronto. A versão original aplicada foi arquivada para manter a rastreabilidade.

## Testes e limites

- Os 39 testes existentes do gateway passaram.
- Oito testes do receptor passaram no Linux, sem ignorados, usando HTTP real e o verificador HMAC real do gateway. Cobrem assinatura/corpo alterado, limites de corpo declarado e em stream, limites por IP/global, mapa de IPs limitado, destinos/métodos indevidos, erros sanitizados e arquivo da chave. No Windows, o teste de arquivo Linux é explicitamente ignorado.
- A política ampliada passou em 128 casos de nftables/UID em namespace descartável. A auditoria de integridade e identidade do runtime permanece ativa.
- Backup e restauração isolada do conjunto SystemOS/Pay passaram antes e depois da implantação. A recuperação do acesso público ocorreu depois; não confundir o ensaio de dados com a validação do conector.
- Verificação final pelo domínio: corpo vazio recusado com 400; aviso sintético com UUID previamente confirmado como inexistente aceito com 200. Depois do envio, o UUID continuava ausente tanto de `payments` quanto de `checkout_notifications`. Esse caso exercita o encaminhamento autenticado e o descarte de referência desconhecida, sem consultar ou confirmar uma transação bancária real.
- Versão web e portal retornaram 200, OS sem sessão retornou 401, catálogo Store retornou 200, túnel ficou ativo/pronto e a auditoria de integridade do firewall passou. O modelo de configuração do túnel no SystemOS agora inclui a rota dedicada, condicionada à saúde do receptor.
- Não houve emissão de cobrança, confirmação artificial, reembolso, migração SQL ou sincronização com Drive. Não se repetiu um pagamento real nesta rodada.

## Operação e recuperação

Fontes: `infra/vps/notification-ingress.mjs`, `Dockerfile.notification-ingress`, `notification-ingress.compose.yaml` e `scripts/publicar-notification-ingress.py`. `npm test` inclui os testes HTTP do receptor; `npm run test:infra` executa os testes do publicador, com limites explícitos de plataforma/privilégio.

No VPS: composição em `/opt/ligado/notification-ingress`, chave em diretório próprio sob `/var/lib/ligado-standby/operational/notification-ingress` e recibos privados em `/opt/ligado/notification-migration-20261112`. A chave é uma cópia protegida do segredo de encaminhamento existente, não uma nova credencial bancária.

O backup financeiro já contém o segredo original do proxy no pacote recuperável do gateway. Em reconstrução de outro VPS, será necessário reconstruir/carregar a imagem por sua fonte, preparar o arquivo para UID 10009 a partir desse segredo restaurado, recuperar a composição, a regra exata do túnel e o perfil de firewall. O ensaio de restauração de dados não iniciou esse fluxo público em outro servidor; **não declarar recuperação integral automatizada do ingresso**.

A separação estrutural das redes do SystemOS/Pay permanece pendente. Esta correção preserva a contenção por processo e resolve um caminho de integração necessário antes daquela migração.
