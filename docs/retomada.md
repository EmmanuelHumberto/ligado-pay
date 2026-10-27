# Estado de retomada atualizado — 27/10/2026

Estado consolidado em 27/10/2026. Este registro substitui as indicações antigas de migração inativa, gateway original ou PAY-07 sem isolamento aplicado. Relatos anteriores são histórico de execução.

- Ler primeiro `CORRECOES_AUDITORIA_2026-10-27.md`: isolamento Windows ativo; tarefas API/Web/Gateway Running; backup e restauração isolada passaram. API/Web usam LigadoSystemOS e gateway LigadoPayGateway.
- Migrações 005/006/007, fila limitada/prioritária, proxy HMAC, monitor completo e conciliação privilegiada de devoluções implementados. Devolução/cancelamento do dinheiro só na conta InfinitePay. Não repetir testes reais já pagos.
- Publicação API/Web e2866253-0d5c-48bc-8311-6492f6127b8a; homologação HTTP pausada. Falta fluxo administrativo para novas releases isoladas; antigo publicador bloqueado.
- Novo backup cifrado: ecosistema/backups/systemos-ligado-pay-restaurado-2026-10-27-043343.enc; recuperação verificada e chave separada. Upload manual pendente.
- APK c98de334 compilado/testado, instalação pendente. Miniaturas/cache de documentos locais do SystemOS ainda não publicados.
- Esta rodada registra commits locais nos três repositórios; não representa push, nova publicação, instalação do app ou operação bancária.

---

## Histórico anterior (consulte o estado atualizado acima)

# Retomada — Ligado Pay

Atualizado em 26/10/2026. Registro para continuar o trabalho sem repetir operações financeiras já realizadas.

## Projeto e decisões

- Diretório: `C:\Users\User\Documents\Projetos\ecosistema\ligado-pay`.
- Remoto: `https://github.com/EmmanuelHumberto/ligado-pay.git`. Nenhum push foi realizado nesta sequência.
- Último commit de implementação: `3c4014b` — proteção da chave e primeiro Pix real. Commit anterior: `e51e8ff` — credencial opaca sem prefixo presumido.
- O gateway é exclusivamente uma API. Não incorporar frontend, CRM, máquinas, OS, orçamento, estoque ou regras comerciais.
- Primeiro consumidor previsto: backend do SystemOS; portal e app passam por ele. Loja futura e outros projetos usarão a mesma API, com autorização própria.
- Banco próprio, sem acesso direto aos bancos consumidores. PostgreSQL local já exclusivo, com papel runtime restrito e identidade separada de migração. Instância separada também foi recomendada para produção; hospedagem e implantação ainda não definidas. Separação não exige necessariamente outro computador físico.
- Prioridade: InfinitePay. Não implementar cobrança fictícia diretamente no Banco Central nem substituir pelo Mercado Pago sem decisão do usuário.

## Primeiro teste real: concluído e pago

O usuário autorizou especificamente criar um único link de R$ 1,00 e depois pediu a verificação do pagamento.

- Conta pública/InfiniteTag informada: `emmanuel-humberto`.
- Cobrança local: `65511ae7-3957-4afd-8663-0d13a934d8db`.
- Criação: uma chamada a `/links`, HTTP 200, URL aceita pelo adaptador e estado inicialmente PENDING.
- O usuário concluiu o checkout. O agente não preencheu dados de pagador nem efetuou o pagamento.
- A tela mostrou sucesso. O botão Continuar forneceu parâmetros de retorno; esses parâmetros foram usados somente como pistas.
- Uma consulta autenticada a `/payment_check`, pelo CheckoutService e adaptador existentes, confirmou Pix, parcela única e ambos os valores de 100 centavos. O gateway persistiu **PAID_PIX**, com settlement e evento/outbox na transação local.
- Evidência sem chave ou dados do pagador: `evidencias/infinitepay-primeiro-pix.json`.
- Isso confirma esta cobrança. Não comprova liquidação final, devolução, assinatura de webhook, recuperação de notificações perdidas ou homologação completa.

**Não recriar nem pagar novamente essa cobrança.** Não remover `.local/infinitepay-validation-attempt.jsonl` para repetir o teste. O arquivo contém a reserva da tentativa e seu resultado inicial; o estado financeiro atual confirmado está no banco, não no resultado PENDING original do marcador.

## Credencial e configuração privadas

- Chave real guardada com DPAPI do usuário Windows e ACL restrita, em `%LOCALAPPDATA%\LigadoTattoo\LigadoPay\infinitepay.dpapi`. Não imprimir, copiar para o Git, passar por argumento ou enviar ao chat.
- O usuário preencheu `infinitepay-entrada.txt` na raiz do projeto. O helper cifrou a chave e o arquivo preenchido foi removido após confirmar a gravação. A raiz tem regra explícita no `.gitignore` para impedir versionamento desse nome.
- O helper suporta entrada oculta, `-DaAreaDeTransferencia` e `-DoArquivo`. Rejeições mostram somente contagens; não presumir prefixo `inchk_`.
- A leitura protegida pela API foi conferida. O teste real funcionou com a credencial configurada; isso não demonstra, por si só, rejeição de uma chave inválida pelo provedor.
- Configuração privada preparada: `.local/infinitepay.runtime.json`. Retorno: `https://os.ligadotattoo.com.br/portal`.
- **Criação geral permanece `liveCreationEnabled=false`.** O comando controlado habilitou somente seu processo para a única operação autorizada, limitada a 100 centavos. Não alterou esse arquivo para habilitar criação geral.
- `.local/` contém configurações e tokens privados. Não exibir seu conteúdo em comandos, logs ou evidências.

## Estado técnico e verificações

- TypeScript/Fastify, PostgreSQL próprio, autenticação de serviço, autorização por aplicação/recebedor, intenção durável, idempotência, referência única e eventos/outbox transacionais implementados.
- Adaptador com destino oficial fixo, timeout, bloqueio de redirects e limite de resposta. Erro de criação pode significar resultado incerto; nunca repetir automaticamente.
- Cartão ou divergência de valor resulta em REVIEW_REQUIRED. Resolução manual ainda não implementada. A mesma transação não pode quitar duas cobranças.
- `npm test`: **27 testes passaram** na última execução. Incluem formato/armazenamento da chave, isolamento HTTP, contrato sintético, plano de validação, concorrência e bloqueio de repetição após erro incerto.
- `npm run infinitepay:verify`: passou com chave sintética, banco real local, criação bloqueada e zero chamadas externas. Não confundir essa verificação com o teste real acima.
- O comando `scripts/infinitepay-live-validation.mjs`, sem argumentos, mostra somente a prévia. A execução real exige flags explícitas e marcador exclusivo sincronizado em disco antes do envio. Não executar novamente para retomar o projeto.
- O PostgreSQL local foi **parado** ao terminar. Nenhuma API ficou rodando por estes comandos. Não remover volumes: contêm o registro financeiro do Pix confirmado.
- Não houve publicação, push, mudança dos pagamentos Mercado Pago existentes ou cadastro de webhook.

## Limites observados no checkout

- O produto usado fornece link de checkout, não QR/copia e cola diretamente pela API implementada.
- Pix e cartão permanecem disponíveis; não apresentar como exclusivamente Pix.
- O checkout exigiu nome, telefone e e-mail antes dos meios de pagamento. O usuário preencheu a etapa; não coletar esses dados por ferramentas para repetir o fluxo.
- O retorno hoje aponta para `/portal`, sem tratamento dedicado integrado ao Ligado Pay. Retornar ao portal não atualiza automaticamente uma OS.
- Validade de uma hora e uso único foram solicitados ao provedor, mas a aplicação efetiva dessas opções ainda não foi comprovada.
- Documentação atual: https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay . Distinguir essa orientação da documentação antiga que usa handle sem API Key.

## Próximos passos

### Avanço local na retomada de 26/10/2026

Foi preparado no repositório consumidor `../os-system-web` o cliente privado `apps/api/src/pagamentos/ligado-pay.client.ts`. Ele está **desligado e não registrado no runtime**; não há nova rota, mudança de saldo/OS ou interface publicada. O transporte está limitado à API local em `127.0.0.1:3305` e recusa ativação em produção nesta fase. Nenhuma chave real foi copiada para o consumidor.

O cliente confere aplicação, recebedor, ambiente, provedor, referência, valor, moeda e URL de checkout. Não repete chamadas, distingue criação incerta de falha anterior ao envio e não considera o redirect prova de pagamento. O teste cruzado passa pelo servidor Fastify, autenticação, schemas e CheckoutService reais, com persistência/conector substituídos em memória e credencial sintética; não acessa o PostgreSQL ou a InfinitePay.

Comandos no consumidor: `npm run test:ligado-pay` e `npm run test:ligado-pay:contract` (este compila o gateway vizinho). Testes e limites estão em `../os-system-web/docs/INTEGRACAO_LIGADO_PAY.md`. O cliente também participa de `test:unit` do SystemOS.

Verificação nesta retomada: **10 testes do consumidor passaram**, incluindo o contrato cruzado; **27 testes do gateway passaram**, sem skips; `contract:check` do gateway e `typecheck` da API do SystemOS passaram. Não foi feita nova chamada à InfinitePay ou alteração de dados financeiros.

**O vínculo financeiro foi preparado localmente na continuação.** `LigadoPayOsService` no consumidor reserva a tentativa antes da chamada, sob o mesmo bloqueio de OS do Mercado Pago, calcula saldo/versionamento no servidor, revalida titularidade após resposta externa e aplica confirmação/evento atomicamente. Há migração 058 com identificação de provedor, ID de gateway separado e índice de tentativa ativa comum, incluindo conferência. Resultado incerto mantém a reserva, inclusive após reinício. Conciliação/cancelamento do Mercado Pago filtram seu próprio provedor. Um vínculo Ligado Pay conserva a exigência de pagamento mesmo com o Mercado Pago desligado; ambientes misturados não são aceitos.

Na etapa do vínculo, o serviço estava **desligado e ainda não registrado no Nest**, sem rota ou alteração de tela; a conclusão abaixo registra o estado atualizado. A migração foi aplicada apenas em bancos descartáveis; o banco operacional não mudou. O código novo comum depende da migração 058, portanto uma futura implantação exige coordenar migração/API após backup e revisão de conflitos. A migração falha e reverte se encontrar tentativas ativas incompatíveis, sem cancelar ou reescrever pagamentos por conta própria.

`npm run test:ligado-pay:db` no consumidor compila isoladamente, usa PostgreSQL de homologação fixo em `127.0.0.1:25432`, cria/remove banco com prefixo exclusivo e usa apenas gateway sintético. Passaram **16 cenários do vínculo** (17 testes com o agrupador), **25 cenários HTTP/SQL do Mercado Pago**, seis testes de migração e a suíte unitária com **207 aprovados, cinco skips e zero falhas**. O teste cruzado de dez casos também passou. O fixture legado passou a enviar origem web válida, respeitando o CSRF existente. A evidência legada desta execução fica em `.runtime`, sem sobrescrever evidências anteriores. O PostgreSQL de homologação temporariamente iniciado para esses testes é parado ao terminar; o banco próprio do Ligado Pay permanece parado e preservado.

### Conclusão do retorno e recuperação no backend

Foi acrescentado `GET /v1/payment-references/:receiverId/:externalReference`, com permissão `payments:read`. A consulta recupera apenas registro existente no gateway, limitado à aplicação, recebedor, ambiente, provedor e conta. Não reserva, não cria e não consulta o provedor, inclusive com criação desligada. Referência ausente devolve 404; não é permissão para recriar. Contrato OpenAPI atualizado e conferido.

No consumidor, a consulta recupera o vínculo perdido pela referência opaca da tentativa e confere a identidade de aplicação/recebedor original. Uma mudança de configuração não pode relincar a tentativa a outra conta. Persistência e autorização da OS são revalidadas ao aplicar o resultado. Foram registrados cliente/serviço/controller no módulo Nest com factories desligadas, sem chave real e sem habilitação por env. A afirmação anterior de serviço não registrado corresponde à etapa anterior: agora há rotas preparadas, mas nenhuma implantação ou ativação ocorreu.

Prefixo preparado no consumidor: `/api/v1/portal/ordens/:ordemId/pagamentos/ligado-pay`, com GET de resumo, POST de intenção, POST `/:tentativaId/consultar` e POST `/:tentativaId/retorno`. Exigem os guards reais de sessão e cadastro aprovado. Retorno aceita somente `orderNsu`, `transactionNsu` e `slug`; cliente/OS/tentativa/valor vêm da autorização e do banco. Não há GET de retorno financeiro. O checkout ainda retorna a `/portal`; a integração visual e o envio do POST pela web/app são pendentes, sem mudança da URL no provedor nesta entrega.

Verificação desta conclusão: **28 testes unitários e 17 testes PostgreSQL do gateway**, **11 testes de transporte/contrato cruzado**, **19 cenários PostgreSQL/HTTP no consumidor (20 testes com agrupador)**, **25 cenários HTTP/SQL legados** e suíte unitária do SystemOS com **208 aprovados, cinco skips, zero falhas**. Tipagem da API e contrato OpenAPI aprovados. As sessões web/nativas são sintéticas, verificadas por guards e banco reais; não houve teste de UI ou instalação de APK. Fluxos incluem outro cliente, CSRF, credenciais misturadas, identidade alterada, campos extras, resposta perdida, recuperação por leitura e retorno repetido. Nenhuma chamada financeira externa.

### Sincronização periódica preparada no consumidor

`LigadoPaySyncWorker` foi registrado no SystemOS com factory desligada, sem ativação por env e sem rota pública. Quando explicitamente configurado, consulta até dez tentativas existentes por rodada, a cada 30 segundos. Usa apenas o método interno `sincronizar`, sem criar/cancelar/devolver. O serviço continua revalidando identidade, ambiente, cliente e orçamento, com limite de segundo plano separado das consultas do usuário.

As tentativas LP em criação/incerteza/pendência são reservadas atomicamente com `FOR UPDATE SKIP LOCKED` e prazo de dois minutos. Outra instância retoma após expiração/queda; a conclusão do processo antigo não sobrescreve o agendamento novo, pois compara o marcador exato da reserva. Sucesso agenda 60 segundos e falha cinco minutos, sem liberar saldo ou apagar reserva. Aprovados e conferência não são consultados automaticamente. O encerramento aguarda a operação em andamento e não adquire outra.

Verificação desta etapa: **quatro testes unitários do worker**, **23 cenários PostgreSQL/HTTP do consumidor (24 testes com agrupador)**, **25 cenários legados**, **11 testes do contrato cruzado** e suíte unitária com **212 aprovados, cinco skips, zero falhas**. Compilação isolada/tipagem aprovadas. Inclui duas instâncias, confirmação única, recuperação de vínculo sem novo POST, referência ausente com bloqueio, expiração e proteção contra atualização tardia. Nenhuma chamada financeira externa. Apenas o PostgreSQL descartável de homologação foi temporariamente iniciado e parado ao terminar.

Foram revisados portal web e os arquivos nativos `PortalPaymentsApi.kt`, `Payments.kt`, `PaymentPanel.kt`. Ambos ainda usam o fluxo Mercado Pago. A conexão visual deve expor as capacidades reais do checkout hospedado nos dois consumidores; não reaproveitar a tela de QR como se a API LP fornecesse código Pix direto. Nenhuma tela, APK ou publicação foi alterada nesta etapa.

### Identidade privada e clientes preparados

Foi executado `../os-system-web/scripts/provisionar-identidade-ligado-pay.ps1`. Criou a aplicação **`systemos-private`, com somente `payments:read`**, token aleatório protegido por DPAPI/ACL em `%LOCALAPPDATA%/LigadoTattoo/SystemOSLigadoPay/service-token.dpapi` e configuração do consumidor na mesma pasta (`config.json`). O token não foi exibido ou passado por argumentos. Nenhuma chave InfinitePay foi copiada para SystemOS, web ou APK.

Configuração separada do gateway: `.local/systemos-readonly.runtime.json`. Contém somente o hash da nova credencial, com criação real desligada, e preserva o arquivo anterior. O helper recusa sobrescrita. Não usar essa identidade para ler o teste de R$ 1,00 anterior: ele pertence à aplicação antiga, isolada por autorização.

A verificação de identidade iniciou temporariamente a API local e fez apenas dois GETs autenticados: readiness (criação desligada) e referência opaca inexistente (404). Encerrou seu próprio processo, sem POST e sem chamada à InfinitePay. A configuração não foi selecionada no SystemOS operacional. O loader depende de `SYSTEMOS_LIGADO_PAY_CONFIG` explícito, recusa produção e `allowCreation=true`; o módulo exige banco descartável `ligado_pay_os_test_<UUID>` nas portas de homologação 25432/35432. Ativação acidental sobre a base operacional é recusada. `syncEnabled=false` foi preservado.

Portal e Android agora têm código para descobrir disponibilidade, exibir estado/saldo e abrir checkout apenas no host HTTPS permitido. Criação só aparece se a API permitir e não houver reserva/conferência; o modo privado atual não permite. Web: componente na OS e retorno global na raiz do portal, com DTO/POST autenticado, sem seguir recibo ou aceitar alegação de pago. Pistas podem sobreviver ao login no `sessionStorage` por 15 minutos e não são fonte financeira. App: contratos/rede/ViewModel com sessão/família existentes e painel na aba de pagamentos; checkout abre no navegador e o retorno é verificado pelo portal autenticado, seguido de atualização no app. **Não há deep link nativo automático nesta etapa.**

Validação dessa etapa: 25 testes PostgreSQL/HTTP do consumidor (inclui agrupador), 25 cenários legados, 11 de contrato cruzado, dois de identidade/DPAPI, dois de URL/retorno web, tipagem web/API e suíte unitária com 216 aprovados/cinco skips. Android: 130 testes e zero erros de lint. A prévia visual pelo navegador não pôde ser conferida porque o navegador local está desabilitado. O APK estava somente compilado naquele momento; a atualização no aparelho foi concluída na etapa abaixo. As entregas finais e hash ficam na documentação de paridade do app e em `../os-system-web/docs/INTEGRACAO_LIGADO_PAY.md`.

### Validação conjunta e atualização no Moto G24

O teste do consumidor passou a compilar os dois backends e executa **SystemOS HTTP → Ligado Pay HTTP → adaptador InfinitePay com transporte sintético**, usando sessão/token reais de teste e bancos PostgreSQL descartáveis em instâncias distintas. A porta 3305 precisa estar livre: não matar outro gateway para executar. O teste agora requer os PostgreSQL de homologação do SystemOS (25432) e do gateway (55439). São **26 testes com o agrupador**, além de 25 cenários legados.

Evidência sanitizada: `../os-system-web/evidencias/ligado-pay-e2e.json`. Uma criação e duas verificações no transporte fictício, zero requisições ao provedor real, settlement único e repetição sem outro evento. Confere referência, valor, retorno pendente, alegação extra rejeitada e confirmação. Os bancos não contêm tabelas um do outro e foram removidos. O código financeiro/credenciais reais do gateway não foram alterados por esse ensaio.

O Moto G24 estava conectado. Foi compilado/instalado o APK `.staging.paymentsqa` separado e sem INTERNET. Passaram **14 cenários físicos**, incluindo leitura LP, conferência, incerteza, confirmação fictícia e toque repetido com apenas um envio. O roteiro precisou ser ajustado para percorrer controles por rolagem, sempre verificando o pacote antes de agir. Não usou a conta operacional. Evidência: `../os_ligado_app/evidencias/pagamentos-ui-aparelho.json`.

O APK principal **foi atualizado e aberto no Moto G24**, com `install -r` (sem desinstalar ou limpar dados), base de API anterior igual, identidade/UID/primeira instalação preservados, assinatura aceita e hash instalado conferido: `dca85c4f44f05378852c7772990402899ef5c25544f86f6b6b3a3183d909a139`. Cópia do APK anterior guardada no diretório privado de homologação. Evidência: `../os_ligado_app/evidencias/ligado-pay-apk-atualizacao.json`. Nenhum botão de pagamento ou login foi acionado no app operacional.

**Instalação não habilita pagamentos.** Backend/web não foram publicados, a configuração privada continua de leitura e o LP só aparece com disponibilidade autorizada. Os testes físicos foram offline e o provedor do E2E foi sintético; não declarar homologação financeira completa. Não repetir o Pix real de R$ 1,00 para continuar. Os dois PostgreSQL temporariamente iniciados para esta rodada foram parados ao terminar, preservando volumes e o registro financeiro anterior.

**Pendências para habilitação real:** rollout coordenado de migração 058/API, rede/infraestrutura de produção e permissões de criação/checagem (a nova identidade é de leitura), validação da jornada em aparelho/navegador, eventos/conciliação no provedor e revisão/cancelamento/devolução. A sincronização lê registros existentes e confirmações já registradas no gateway; não descobre transações ausentes no provedor nem monitora estornos/contestações nesta fase. Se nem o gateway conhece o resultado, manter bloqueio e conciliar, sem apagar reserva ou inventar que a cobrança falhou. Não associar o teste real de R$ 1,00 retroativamente a uma OS.

Esta preparação não habilita criação real, não altera webhook e não publica serviço. O banco e o marcador do teste pago permanecem preservados.

### Sequência restante

### Nova operação integrada proposta (ainda não emitida)

### Correção posterior — notificações e confirmação automática

O teste do usuário criou UMA cobrança de 100 centavos na OS **1145**, apesar de
ele inicialmente mencionar 1144. Vínculo SystemOS
`64f73bec-0da2-4af7-81e0-5ea8984ebca8`, gateway
`f24a8597-d4e8-4ea1-9598-4a1717bc8b68`. Última verificação: PENDENTE/PENDING,
zero centavos confirmados. O usuário informou pagamento por outro banco, após
recusa de pagar usando a própria conta recebedora. Não criar outra cobrança,
remover o limite de uma reserva, alterar vínculo ou marcar como pago por recibo.

Foi corrigida a dependência exclusiva do retorno pelo navegador. Migração 003
adiciona inbox de correlações; backup prévio do ledger está protegido em `.local`.
`InfinitePayNotifications` persiste somente IDs/slug antes de responder, deduplica,
limita fila, usa lease com fencing e reconsulta `/payment_check` com a chave do
servidor. Conteúdo público não é prova de pagamento; assinatura de origem do
webhook não foi inventada. Erro/pagamento ainda pendente tem backoff, até oito
tentativas. Esgotamento fica FAILED na inbox, sem mudar estado financeiro.
Nenhum callback cria cobrança ou realiza devolução. O gateway não acessa banco OS.

Novos links configurados incluem `webhook.url` e eventos `paid`/`settled` conforme
ajuda oficial. A configuração separada do piloto aponta para
`https://os.ligadotattoo.com.br/ligado-pay/webhooks/infinitepay`, proxy do Next
somente para `/webhooks/infinitepay` do gateway privado. Identidade fixa do piloto
determina aplicação/recebedor, nunca o corpo público. Outros endpoints continuam
privados/autenticados. Limite de criação 100 centavos/uma reserva foi preservado.

Publicado SystemOS build `b8858eaa-0eac-48e4-bb9f-94e61f19ca74`. A API de OS
continua sincronizando somente registros do gateway. Portal/app releem estado
pendente a cada cinco segundos enquanto visíveis, com limite de cinco minutos,
e ao voltar à tela. Retorno do portal também é reavaliado ao carregar sessão.
APK `aed4943ed1cadfa0b5bcd77f1021fb3efe4e023ca46e7ee281a264ca91cba0a6`
foi instalado com `adb install -r`, identidade preservada e hash instalado
conferido. Não foi acionado pagamento no aparelho pelo agente.

Validação: gateway 30 unitários e 19 PostgreSQL; recebimento fictício conhecido,
repetição, origem browser recusada, referência desconhecida, concorrência entre
workers, falha de consulta e confirmação/evento/settlement únicos. Transporte
externo sintético. Probe público com UUID desconhecido retornou 200 sem enfileirar;
corpo inválido retornou 400. Zero chamadas financeiras externas nesses probes.
Android 130 testes, zero erros lint; API/web compilados e publicados. Evidências
nos consumidores: `ligado-pay-webhook-publicado.json` e
`ligado-pay-webhook-apk-atualizacao.json`. Não afirmar entrega real de webhook:
nenhum evento do provedor chegou durante esta rodada.

**Recuperação do pagamento existente permanece pendente:** o link foi emitido
ANTES do cadastro de webhook. O usuário enviou PDF bancário Bradesco e recibo
InfinitePay de extrato (`capture_method/origin=statement_pix`, valor 100).
Nenhum contém `transaction_nsu`/slug do checkout. UUID visto no HTML era CHAVE PIX,
não ID de transação: NÃO enviá-lo ao payment_check. Materiais e extrações estão
somente no diretório privado PilotR1, não no Git. É necessário obter o retorno
do checkout existente (`Continuar`/`Voltar à loja`) ou os identificadores da venda
de checkout na InfinitePay. Não usar scraping autenticado de banco, extrato,
nome/valor coincidentes ou um recibo como substituto da confirmação pela API.
Nenhuma consulta payment_check real foi enviada sem esses identificadores.

Os parágrafos seguintes descrevem etapas históricas anteriores à publicação.

**Estado mais recente — piloto publicado:** o usuário pediu para apenas habilitar
a função, escolhendo pessoalmente a OS e o serviço de R$ 1,00 pelo app. Foi
publicado o build SystemOS `72e84bf4-e529-4ffe-bd76-01e5598f06a4`, após backup
completo/cópia cifrada e migração 058. O modo privado `controlled-pilot` usa uma
nova identidade `systemos-pilot-v1`, máximo 100 centavos e `maxPayments: 1` no
gateway; criação até 2026-10-27T19:51:25Z. O consumidor também bloqueia outra
reserva globalmente sob advisory lock. Nenhuma OS foi criada ou escolhida pelo
agente e nenhuma cobrança foi emitida. A verificação constatou zero reservas do
piloto nos dois bancos. Gateway real em loopback 3305, PostgreSQL próprio 55439,
readiness autenticada 200; rota do portal sem sessão 401. Os serviços necessários
ao piloto ficam ligados; apenas o PostgreSQL descartável 25432 é parado após testes.
O modo local padrão permanece bloqueado em produção; a exceção é a composição
explícita limitada do piloto. Não executar o comando de operador abaixo.
Detalhes e evidência em `../os-system-web/docs/INTEGRACAO_LIGADO_PAY.md` e
`../os-system-web/evidencias/ligado-pay-piloto-publicado.json`. Ainda falta o usuário
gerar/pagar e validar a jornada real. Não declarar isso homologado antes de confirmar.

**Atualização de preferência:** o usuário quer gerar pelo app/web um serviço de
R$ 1,00, e não por comando de operador. NÃO executar o comando abaixo como se
validasse essa jornada. Foi perguntada a OS/conta ou preferência por uma OS nova.
No consumidor foi preparado um escopo de piloto no serviço, ainda sem ativação
nas factories/configurações. No gateway foi adicionado o limite opcional
`maxPayments` à credencial: é preservado na autenticação e aplicado sob lock na
reserva PostgreSQL, após a recuperação idempotente. Conta todos os estados por
aplicação/recebedor/ambiente; intenção incerta também consome. Nenhuma configuração
privada foi alterada. Testes atuais: gateway 29 unitários e 18 PostgreSQL;
consumidor 27 integrados com agrupador e 25 cenários legados. Tudo sintético.
Ver `../os-system-web/docs/INTEGRACAO_LIGADO_PAY.md`, seção do piloto pelo app.

O usuário solicitou um novo teste real. Foi preparado no consumidor o comando
`../os-system-web/scripts/validar-ligado-pay-real.cjs`. Sem argumentos, imprime
somente o plano, sem carregar credenciais, consultar bancos ou chamar provedor.
Três testes do comando passaram. A regressão existente passou novamente: 26 testes
de integração e 25 cenários legados, com transporte do provedor sintético.
Isso não equivale a executar ou homologar financeiramente o novo comando.

Plano concreto: uma nova cobrança de R$ 1,00 na conta `emmanuel-humberto`, via
serviço financeiro do SystemOS → cliente HTTP → API privada do gateway → InfinitePay.
Usa OS sintética em banco RETIDO `ligado_pay_os_validacao_real_v1`, separado da
base operacional. O registro do gateway fica em seu próprio `ligado_pay_local`,
com aplicação `systemos-validation-v1`. Não reutiliza o Pix anterior nem o associa
retroativamente a uma OS. Não publica nem habilita criação para os clientes.

Antes de executar, obter autorização desse valor e efeitos, conforme AGENTS.md.
O comando de criação exige `--execute --confirm=SYSTEMOS_ONE_BRL_1_LINK`.
Seu marcador exclusivo fica em `%LOCALAPPDATA%/LigadoTattoo/SystemOSLigadoPay/integrated-real-v1.jsonl`;
reserva e fsync antecedem mutações ou chamadas financeiras. Em falha, preservar
marcador e bases, conciliar e NÃO repetir criação. Não existe exclusão/reset automático.
Configuração permanente e identidade anterior de leitura não são alteradas.
O gateway temporário escuta somente 127.0.0.1:3305 e fecha ao terminar; porta ocupada
interrompe o ensaio, sem matar processo alheio. Cada execução permite no máximo uma
requisição ao provedor, ao endpoint correspondente à ação autorizada.

Depois da emissão, o usuário escolhe Pix e paga manualmente no checkout externo.
Cartão também aparece na página do provedor; não afirmar que é checkout exclusivo Pix.
Não há pagamento ou devolução automáticos. `--read` recupera o registro pelo gateway
sem chamar o provedor. Para verificar uma transação, preparar privadamente
`integrated-real-v1-hints.json` no mesmo diretório, somente com `orderNsu`,
`transactionNsu`, `slug`, e executar `--check` (uma consulta autenticada ao provedor).
Nunca seguir recibo/redirect como prova de pagamento; conferir estado retornado e
saldo aplicado na OS sintética. O comando testa o backend integrado, não a jornada
publicada do portal/APK, que permanece uma etapa separada.

Os dois PostgreSQL usados na preparação foram restaurados ao estado parado após
os testes. Nenhuma nova cobrança foi emitida nesta preparação.

1. Ler `AGENTS.md`, este arquivo, `docs/infinitepay.md`, arquitetura e modelo de ameaças. Conferir Git e estado do banco sem imprimir segredos.
2. Continuar a integração SystemOS → API do Ligado Pay a partir do cliente privado já preparado, inicialmente desligada. Ler as instruções do repositório SystemOS antes de modificá-lo. O gateway não acessa sua base nem decide aprovação/saldo de orçamento.
3. Preservar e ampliar os testes do vínculo financeiro preparado no SystemOS. Ligar autenticação de sessão e DTO nas futuras rotas e manter titularidade, orçamento, saldo e concorrência antes de solicitar cobrança. Preservar pagamentos existentes.
4. Validar a conexão visual preparada no portal/app e o retorno pelo navegador em aparelho, mantendo a identidade local de leitura. Definir rollout/infraestrutura antes de habilitar criação ou checagem reais. Portal/app nunca recebem a chave InfinitePay ou token de serviço. Redirect ou comprovante não confirmam pagamento.
5. Completar recuperação de resultados incertos, conciliação e entrega autenticada dos eventos/outbox, com deduplicação. Não abrir webhook confiando apenas no corpo; autenticidade/replay ainda precisam ser comprovados conforme contrato do provedor.
6. Definir devolução, tratamento de revisão manual e ciclo de cancelamento/estorno. Não inventar endpoints nem prometer garantias não demonstradas.
7. Antes de produção: limites financeiros agregados, rede e identidades, proteção do host, observabilidade, cofre/rotação, backup cifrado externo e restauração, além de revisão de segurança.

O usuário autoriza prosseguir no desenvolvimento. Uma **nova operação financeira real** precisa ter seus efeitos concretos apresentados e autorizados conforme `AGENTS.md`; o teste de R$ 1,00 já concluído não autoriza cobranças adicionais. Não insistir em obter sandbox: o usuário informou que essa seleção não existe na conta. Desenvolver com documentação e testes locais, registrando limites reais.


## Fechamento do teste real — OS 1145 confirmada

Verificado em 26/10/2026 às 18:29 (Brasília): OS 1145 APROVADO, gateway PAID_PIX, 100 centavos confirmados, zero estornados. Confirmação registrada às 18:25:01. Um settlement e um evento PAID_PIX, sem duplicidade ou nova cobrança. A inbox de webhook permanece vazia; não atribuir esta confirmação à entrega de webhook. A afirmação anterior de pendência está superada. Evidência sanitizada em `evidencias/ligado-pay-conciliacao-os1145.json` no SystemOS. Não repetir o pagamento, remover a reserva do piloto ou reutilizar o teste antigo.


## Segundo teste autorizado — fechar o checkout antes do pagamento

Usuário relatou que a primeira confirmação ocorreu ao reabrir uma aba Chrome e se disponibilizou para mais um teste. Foi publicado o build `477f70c9-5353-4b44-bab1-ebc3bd0631f4`, mantendo identidade, chave, registros e prazo originais. Limite total do piloto passou de UMA para DUAS reservas, máximo 100 centavos cada, tanto no SystemOS quanto no gateway: exatamente uma emissão adicional. OS 1145 permanece APROVADO/100 centavos. Não apagar histórico nem alterar idempotência. Nova tentativa deve usar outra OS elegível com total/saldo aprovado de R$ 1,00. O agente não criou cobrança nem pagou.

Procedimento: gerar pelo app, copiar Pix, FECHAR a aba do checkout antes de pagar no banco e voltar somente ao app. Não abrir o checkout/retorno, para não confundir o canal de confirmação. Verificar inbox, consulta autenticada, settlement/evento únicos e baixa no consumidor. O webhook está configurado para links novos; entrega financeira real ainda NÃO foi comprovada. Logs do gateway agora registram recebimento/rejeição e presença booleana dos campos esperados, sem corpo, IDs, segredos ou dados pessoais.

Validação: três testes de configuração, 28 integrados com agrupador e 25 casos legados aprovados, incluindo duas reservas permitidas e terceira recusada sem chamada ao gateway. Um cenário isolado precisou limpar o bucket sintético de rate limit entre testes, sem mudar o limite operacional. Backup atualizado de 77 tabelas/190 objetos, cópia AES-256-GCM verificada; snapshot privado do gateway. Token/identidade e dados anteriores preservados. Evidência `evidencias/ligado-pay-segundo-teste-preparado.json` no SystemOS. APK `aed4943e...` anterior contém polling necessário, sem reinstalação nesta etapa.


## Segundo teste real — webhook recebido, ajuste de retomada nativa

OS 1147: webhook recebido em 26/10/2026 19:03:25 (Brasília), inbox DONE com uma tentativa, gateway PAID_PIX e SystemOS APROVADO/100 centavos às 19:04:22. Um settlement e um evento PAID_PIX. Evidência `evidencias/ligado-pay-segundo-teste-webhook.json` no SystemOS. Usuário esclareceu que precisou tocar Atualizar confirmação DENTRO do app Ligado Tattoo, não no checkout Chrome. A entrega real de webhook foi observada; a atualização automática da tela ainda exigiu correção nativa.

Em andamento nesta etapa: retomada por Activity.onResume e revisão explícita no estado, consulta automática da tentativa existente (POST consultar com autenticação, sem criar cobrança) e preservação da OS/aba durante releitura. Releitura anterior via GET podia ficar atrás do gateway até o worker sincronizar. A nova atualização antecipa essa sincronização sem depender do navegador, mantém limite/backoff e para em background. Nenhum novo limite foi aberto; as DUAS reservas autorizadas já foram consumidas e estão confirmadas. Não solicitar terceiro pagamento por esta etapa. Atualização final do APK deve ser conferida na documentação do app.


## Retomada do banco — correção instalada em 26/10/2026

Segundo teste real confirmado por webhook na OS 1147, uma tentativa de inbox e um settlement/evento. Usuário precisou tocar Atualizar confirmação no app, não na página InfinitePay. A atualização anterior apenas lia cache OS; o POST consultar da tentativa existente sincronizava imediatamente com o gateway.

MobileActivity agora sinaliza foreground em onResume. PortalUi transporta foreground/revisão explícitos; OrderPanel preserva aba com rememberSaveable; reloadOrder mantém a tela durante a consulta e valida geração/OS antes de aplicar. LigadoPayPanel consulta a tentativa existente automaticamente ao retomar e enquanto pendente (5 segundos, até cinco minutos), para em background e reinicia a janela ao retornar. Não cria/cancela/cobra de novo. Os guardas de sessão, família, geração, cadastro e titularidade foram mantidos. O navegador permanece apenas para o checkout/cópia do Pix: não é necessário retornar a ele para a confirmação já comunicada por webhook.

132 testes aprovados, zero erros de lint, incluindo dois cenários Compose sem toque em botão: retorno do banco com cache local antigo e revisão de retomada sem mudança de foco da janela. APK 559637b1cf0d752b1fe6f5c152c03cd7803311cee7b5b47202a603f34d407f4b instalado no Moto G24 com install -r, UID/primeira instalação preservados, hash do pacote instalado conferido e app aberto com processo ativo. Cópia anterior protegida. Artefato OS-Ligado-Retorno-Banco-2026-10-26-559637b1.apk. Evidência `evidencias/ligado-pay-retorno-banco-apk.json`. Não foi feito terceiro pagamento ou um novo round trip bancário real após a atualização. Servidor/portal não precisaram de nova publicação nesta etapa. As duas reservas autorizadas continuam consumidas e confirmadas.


## Operação privada — OS 1148 liberada, sem quota de testes

O usuário autorizou remover o bloqueio do piloto e liberar o pagamento da OS 1148 sem desfazer sua aprovação. Publicado build `fd260087-a31e-4298-af17-b9afee557983`. Configuração selecionada mudou para `private-operation`: sem maxPayments, sem valor fixo de teste e sem creationExpiresAt. O servidor não injeta mais LigadoPayPilot nessa composição. No gateway foi removida apenas a quota vitalícia da credencial, mantendo aplicação/recebedor/ambiente/chave e os vínculos financeiros anteriores. O nome histórico systemos-pilot-v1 e os caminhos PilotR1 foram preservados para não quebrar fingerprints das cobranças já registradas. A validação técnica de centavos inteiros continua até 100000000 centavos, limite do contrato existente, e a cobrança é sempre o saldo aprovado calculado pelo SystemOS. Não há habilitação via flag pública ou dados do app.

Idempotência, exclusividade de tentativa ativa entre provedores, titularidade, cadastro aprovado, hash do orçamento, decisões completas, saldo, fechamento, ambientes, webhook/reconsulta e estados incertos/conferência continuam sendo exigidos. Sem arquivo privado explícito, padrão continua desligado. Não resetar pagamentos ou gerar cobranças de teste automaticamente.

Verificação real: OS 1148 com um item APROVADO, total e saldo 100 centavos, nenhuma tentativa criada e podePagar=true. Aprovação NÃO foi desfeita. Gateway autenticado ready, quota ausente, identidade preservada. Evidência `evidencias/ligado-pay-os1148-liberada.json` no SystemOS. 219 unitários aprovados/cinco skips; 29 integrados com agrupador e 25 cenários legados aprovados, incluindo operação após histórico de piloto e preservação de aprovação/idempotência. Backup 77 tabelas/190 objetos e cópia cifrada verificada; snapshot do gateway e configurações anteriores protegidas com DPAPI. Nenhuma cobrança ou pagamento feito pelo agente.

Mudança de servidor apenas: portal publicado; APK 559637b1...407f4b já instalado continua compatível e mostra Preparar pagamento após reler a OS. Não houve nova compilação/reinstalação Android nesta liberação. Esta nota supera os limites e prazos do piloto descritos nas etapas anteriores; ela não declara implementados cancelamento/devolução/revisão manual ou demais requisitos de operação ainda pendentes.


## Operação de exceções do Pix — 26/10/2026

Usuário confirmou: devolução/cancelamento só pela conta InfinitePay. Implementado registro auditado de intenções/evidências e de avisos não verificados, sem movimentação de dinheiro e sem marcar estorno concluído. Orientação e comandos em docs/operacao-pix.md. Não tratar esse recurso como um ciclo financeiro de devolução completo: baixa de devolução no SystemOS ainda exige conciliação verificada.

Migration 004_payment_operations aplicada ao banco exclusivo com snapshot anterior. Papel runtime recebeu apenas SELECT/INSERT na trilha; alteração/exclusão recusadas. Permissão payments:operations restrita à credencial privada do servidor, nunca ao app. Rotas de operação somente loopback; proxy público continua limitado ao webhook. Identidades/recebedor preservados e limites artificiais de piloto não reintroduzidos.

Recuperação manual idempotente da fila esgotada com dados do checkout; não cria nova cobrança. Reporta criação incerta, falta de correlação, fila esgotada, conferência e link vencido. Expiração não cancela nem libera nova cobrança; SystemOS oculta URL vencida mantendo a tentativa. Monitor operacional existente lê o gateway e registra códigos sem dados financeiros pessoais. Avisos refunded/canceled não comprovam devolução. Links anteriores não são alterados retroativamente.

Validação: 30 testes unitários do gateway, 21 integrados PostgreSQL, teste do monitor, integração HTTP entre repositórios e 25 cenários legados aprovados. Consulta indevida à confirmação recusada antes de enfileirar pistas; webhook de devolução/cancelamento não altera estado financeiro. Nenhum pagamento/devolução executado pelo agente. APK anterior permanece compatível; nenhuma compilação/instalação Android necessária nesta etapa de servidor.


## Correções da auditoria — 27/10/2026 UTC

Ler `CORRECOES_AUDITORIA_2026-10-27.md` e a seção atualizada de `operacao-pix.md`. Migrações 005/006/007 aplicadas; role runtime não insere conciliação de devolução. Proxy HMAC publicado no Next e exigido no gateway; chave independente protegida fora dos repositórios. Configuração local selecionada mantém emissão e identidade financeira existentes, sem limite vitalício novo. Nenhuma operação financeira real nesta rodada.

Ainda falta PAY-07: migração dos processos para identidades Windows distintas; sessão atual não elevada. Plano em SystemOS/docs/ISOLAMENTO_RUNTIME_WINDOWS.md e evidência em SystemOS/evidencias/isolamento-pagamentos-windows.json. Não declarar concluído. O APK de pagamentos foi gerado e passou 132 testes/lint; Moto G24 ausente no ADB, portanto não foi instalado.

Há mudanças locais anteriores de portal/login/documentos preservadas. Esta rodada não fez commit nem push. Não repetir testes reais já pagos.


### Estado exato ao encerrar esta rodada

- Publicação web/API saudável: e2866253-0d5c-48bc-8311-6492f6127b8a. Gateway original retomado; proxy sintético 200 e JSON comprimido rejeitado com 415.
- Gateway: 31 unitários + 25 de integração; SystemOS: 223 unitários + 29 de integração, cinco skips no unitário; Android: 132/lint zero. APK c98de334... disponível e não instalado.
- Arquivo para cópia manual: ecosistema/backups/systemos-ligado-pay-seguranca-1793067077880.enc. Restauração dos dois bancos, decifragem/extração e 173 hashes conferidos; ferramentas de recuperação atualizadas, chave existente preservada. Nenhum upload.
- PAY-07 aberto: tentativas administrativas criaram LigadoSystemOS e LigadoPayGateway, mas a partida das tarefas falhou. Ambas as contas e as tarefas Ligado Runtime API/Web/Gateway estão DESATIVADAS. Nenhum active.json está ativo; produção permanece no contexto original. Não confundir testes preliminares de ACL com isolamento aplicado.
- O teste administrativo em portas separadas foi bloqueado pela revisão automática ("blocked by policy"); não contornar a rejeição com outro método. Diagnóstico somente de leitura foi permitido e executado. Node não criou stderr/stdout sob as tarefas. Lançador atualizado no repositório define PSModulePath antes de carregar cmdlets e passou em teste sintético WinPS5; teste sob conta dedicada permanece pendente. Protótipo -Install foi bloqueado para evitar repetição da troca sem validação.
- Scripts experimentais de reparo/recriação foram retirados; preservar evidências privadas .runtime/runtime-isolation-result.json e isolation-readonly-diagnostic.json para diagnóstico. Diretórios protegidos em ProgramData e perfis das tentativas não foram apagados.
- Contêiner de teste os-ligado-homologacao-postgres-1 voltou a parado. Contêineres operacionais preservados. Nenhum commit/push nesta rodada.
