# Rotação de credenciais de aplicação

Implementação de 27/10/2026. A chave Bearer identifica uma credencial; applicationId
continua identificando a aplicação dona dos pagamentos. Não renomear aplicação,
recebedor, conta, ambiente ou referências para trocar a chave.

## Modelo validado

Uma aplicação pode ter até duas entradas durante a troca. Ambas precisam manter
receiverIds, permissions e todos os limites iguais. As cotas persistidas e a
idempotência continuam por aplicação/recebedor/ambiente, não por chave.

Cada entrada da dupla exige keyId único e notBefore. Pelo menos uma exige expiresAt;
o período notBefore→expiresAt dessa entrada é limitado a 24 horas. As janelas
precisam ter interseção. Formato de data: UTC ISO com milissegundos, por exemplo
2026-10-27T12:00:00.000Z. Hashes duplicados, IDs repetidos, terceiro token,
datas inválidas e políticas divergentes impedem a inicialização.

expiresAt é exclusivo: no instante da expiração, a chave já é recusada. revokedAt
também impede autenticação a partir do instante informado. Essas datas são avaliadas
em cada pedido. **Os arquivos de configuração são carregados na inicialização**:
editar revokedAt em disco requer reinício controlado do gateway. Uma revogação
futura já carregada é aplicada pelo relógio do processo, sem reiniciar nesse instante.

A entrada legada única continua compatível. Metadados de chave/ciclo de vida e hash
não são incluídos no Principal nem nas respostas HTTP. O keyId é um identificador
administrativo; ele não muda o Bearer enviado pelo consumidor.

## Procedimento operacional

1. Preparar cópia protegida da configuração atual e material de recuperação. Gerar
   novo token de 32 bytes aleatórios, sem imprimir ou enviar pelo chat.
2. Cifrar o novo token por DPAPI sob cada identidade consumidora que precisará
   utilizá-lo (LigadoSystemOS e operador para recuperação). Um blob CurrentUser
   criado pelo operador não pode simplesmente substituir o blob da conta de serviço.
   Não ampliar ACLs nem executar o servidor sob o operador para contornar isso.
3. Preparar a configuração do gateway com hash novo e antigo, políticas idênticas,
   IDs administrativos e janela curta. Para o token antigo, notBefore representa
   o início desta janela de substituição, não uma prova de sua data de emissão.
4. Publicar a configuração coordenadamente, reiniciar o gateway e verificar por
   consulta de uma cobrança existente que as duas credenciais funcionam no mesmo
   escopo. Não criar cobrança para testar autenticação.
5. Substituir atomicamente o arquivo DPAPI selecionado pelo SystemOS, mantendo
   sua pasta e identidade. O carregador existente invalida cache pela versão do
   arquivo. Atualizar também a cópia protegida do operador/material de recuperação.
6. Confirmar leitura autenticada e pagamentos anteriores. Dentro da janela é
   possível restaurar a seleção anterior se o consumidor falhar parcialmente.
7. Revogar a chave anterior, reiniciar para carregar a revogação e confirmar 401
   para a antiga e leitura para a nova. Arquivar a alteração de configuração no
   registro administrativo protegido. Só então remover a entrada antiga, antes
   de iniciar outra rotação. Gerar backup e ensaiar a restauração.

Não automatizamos nesta rodada a troca dos blobs DPAPI entre identidades Windows,
nem alteramos a credencial operacional existente. Não há endpoint HTTP de gestão
de chaves. O procedimento administrativo deve preservar a proteção CurrentUser e
a recuperação coordenada antes de executar uma troca real.

## Evidências e limites

36 unitários do gateway e 26 integrados PostgreSQL aprovados. O cenário HTTP cria
pagamento sintético com uma chave, recupera com outra, mantém idempotência, quota
vitalícia e rate limit compartilhados e recusa a revogada após reconstruir o servidor.
Cinco testes de configuração SystemOS passaram, incluindo substituição atômica
de token DPAPI e retorno à seleção anterior. Testes DPAPI executam sob o operador,
não comprovam provisionamento de um token novo sob a conta LigadoSystemOS.

São credenciais entre serviços. Esta mudança não rotaciona API Key InfinitePay,
chave HMAC do proxy ou sessão do cliente e não exige novo APK.

## Situação da publicação

Código compilado e testes aprovados. A tentativa administrativa foi cancelada no
UAC do Windows antes de iniciar o publicador; o runtime não foi alterado. Manifesto
preparado: 1603e92efdd0b1ea18851a1caa49ff846322a827f80eb55cb96625dd14c3d819.
Não confundir o resultado PUBLISHED anterior em SystemOS/.runtime com esta tentativa.
Evidência desta rodada: evidencias/rotacao-credenciais-2026-10-27.json.
A credencial operacional permanece intacta; publicação e provisionamento coordenado
de um novo segredo nas contas de serviço ainda precisam de execução administrativa.

## Publicação concluída após nova autorização — 27/10/2026

UAC aceito na nova tentativa. Suporte à rotação publicado na release
release-eef4092b0e30427ab948b4454923148a, manifesto gateway
1603e92efdd0b1ea18851a1caa49ff846322a827f80eb55cb96625dd14c3d819.
Build API/Web 87b40668-f6f2-482d-b11c-9efeaa225a46 preservado. API/Web/Gateway,
identidades, loopback, prontidão autenticada e domínio público verificados.
Uma cobrança existente foi consultada pela API autenticada, com estado, valor e
referência iguais ao banco, em transação somente leitura e sem chamar o provedor.

A chave operacional não foi substituída. Publicou-se a capacidade de coexistência,
expiração e revogação; o provisionamento e a troca real DPAPI entre contas de serviço
continuam como procedimento administrativo coordenado. Sem migração, cobrança ou
movimentação financeira. Recuperação administrativa protegida em
publication-d3a699e5af154ee7b40c5c16886f3af3. A nota anterior de cancelamento é histórica.

## Troca operacional concluída

O SystemOS executou o procedimento administrativo de provisionamento sob LigadoSystemOS e troca coordenada. Resultado PASSOU/COMPLETED: a nova credencial foi protegida por DPAPI sob o serviço e sob o operador, e as configurações runtime/recuperação do gateway foram atualizadas. A janela preservou applicationId, receiverId, permissões, limites e referências; após a revogação, a credencial anterior retornou 401 e a nova consultou pagamento existente com campos financeiros iguais. Gateway/API/banco e domínio público conferidos depois da troca. Nenhum endpoint ou contrato de pagamento foi modificado; nenhuma cobrança ou chamada ao provedor foi feita para testar.

Procedimento e recuperação: ../../os-system-web/docs/ROTACAO_OPERACIONAL_BEARER_2026-10-27.md. Evidência sanitizada: ../../os-system-web/evidencias/rotacao-operacional-bearer-2026-10-27.json. 25 testes operacionais SystemOS aprovados. O backup de dados e a restauração isolada posteriores à troca foram executados manualmente e passaram às 22:23:35 UTC: 79 tabelas SystemOS, 192.445 registros, 200 objetos e banco do gateway, hashes e sequências conferidos sem alterar produção. O ensaio não comprova portabilidade de DPAPI para outra identidade/host, que exige reprovisionamento. Upload externo permanece pendente; a nota de chave operacional intacta nas seções anteriores descreve somente aquele marco histórico.
