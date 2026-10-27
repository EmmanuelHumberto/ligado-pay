# Auditoria da integração de pagamentos — 26/10/2026

Avaliação da árvore de trabalho atual de `ligado-pay` (base b968507), `os-system-web` (base aa6e313, com correção posterior do retorno Google publicada) e `os_ligado_app` (base 5ea5a41, com layout posterior instalado no APK 8433db46). Data de referência: America/Sao_Paulo; alguns horários das evidências já estão no dia 27 em UTC.

## Resultado

Foram identificados três achados de prioridade alta e cinco de prioridade média. Os problemas mais relevantes são disponibilidade da confirmação, dependência vulnerável na API e cobertura incompleta de backup. Isso não equivale a comprovação de desvio de dinheiro.

Nos cenários executados, isolamento entre aplicações/recebedores/contas, titularidade da OS, cálculo do saldo no servidor, exclusividade da tentativa ativa e confirmação idempotente funcionaram. Quatro consultas de leitura à InfinitePay não confirmaram combinações trocadas de pedido/transação/fatura. Não houve nova cobrança, devolução, cancelamento ou alteração financeira operacional nesta auditoria.

## Escopo e método

- Leitura dos serviços, adaptador, HTTP, persistência e quatro migrações do gateway; cliente, controllers, DTOs, serviço de OS, regras financeiras e worker no SystemOS; painel, transporte e verificações de sessão/OS no Android; retorno e abertura do checkout na web; scripts de configuração, monitoramento e backup relevantes.
- Testes de regressão e reprodução em PostgreSQL descartável com provedor sintético. O banco criado pelo diagnóstico foi removido ao término. Os testes não carregam credenciais bancárias.
- Consultas oficiais `payment_check` para uma transação já confirmada, com identificação omitida das evidências: consulta correta; pedido inexistente; fatura diferente; outro pedido existente do mesmo valor. Nenhuma dessas consultas altera o livro financeiro local.
- Leitura das portas, permissões do papel do banco, identidade dos processos, ACL e manifesto do backup. Consultas públicas de baixa frequência; nenhum teste de saturação em produção.
- `npm audit` nos dois backends, consulta OSV de 259 coordenadas Maven dos lockfiles e conferência do runtime selecionado no app. Busca dos valores reais das credenciais da integração em 1.147 arquivos versionáveis, 57 arquivos estáticos publicados e 987 entradas do APK: nenhum valor encontrado. Essa checagem não prova ausência de qualquer outro segredo possível.
- Nenhuma correção de runtime foi publicada durante a auditoria. Foram acrescentados diagnóstico reproduzível, evidências e este relatório. Alterações anteriores do usuário foram preservadas.

## Achados

### PAY-01 — Alta: fila pública pode impedir a confirmação legítima

**Evidência:** `src/infrastructure/infinitepay/notifications.ts:36–50`; `src/application/payment-operations.ts:73–78`. Reprodução em `scripts/audit-integration-security.mjs`, resultado `evidencias/auditoria-integracao-2026-10-26.json`.

O webhook aceita pistas sem autenticidade comprovada para um pagamento existente. Não confere a fatura com o link salvo antes de ocupar a fila. Oito combinações falsas de transação/fatura ocupam as oito vagas pendentes e a notificação correta recebe 429. Após simular a conclusão malsucedida dos lotes, 64 pistas falsas esgotam o limite vitalício; a pista correta continua recusada, inclusive pela operação autenticada de reconciliação.

**Condição:** conhecer o UUID de uma cobrança pendente. Não foi demonstrada descoberta de UUID de outra pessoa. A reprodução conhece o UUID de sua própria cobrança sintética. O impacto é impedir/atrasar a confirmação, não aprovar um Pix falso.

**Correção:** validar a fatura conhecida antes de persistir; separar pistas não verificadas de consultas confiáveis; limitar ocupação por cobrança/transação sem tornar o histórico de erros um bloqueio permanente; oferecer recuperação autenticada que preserve evidências e permita consultar a pista correta. Reprovar ou expirar uma pista não deve cancelar nem recriar cobrança.

**Aceite:** oito/64 pistas falsas não impedem a confirmação legítima; nenhuma pista falsa muda estado financeiro ou dispara nova emissão.

### PAY-02 — Alta: body-parser vulnerável no processo da API

**Evidência:** instalado `body-parser 2.3.0` sob `apps/api/node_modules`, via Express/Nest. `apps/api/src/main.ts` usa o parser padrão, sem `inflate:false`. A advisory [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) descreve encerramento do processo por requisição comprimida com bytes excedentes, antes da autenticação, e correção em 2.4.0.

O impacto potencial alcança o SystemOS inteiro, incluindo pagamentos. O código e a versão satisfazem as condições do aviso; a carga de exploração não foi enviada à API operacional. Controles efetivos de WAF sobre essa carga específica não foram verificados.

**Correção:** atualizar a dependência compatível com a versão de Nest utilizada ou rejeitar compressão de corpo se não necessária; validar em processo isolado e executar regressão antes da publicação. Não executar `npm audit fix --force` indiscriminadamente: o resolvedor sugeriu inclusive mudança de versão do adaptador Nest.

**Aceite:** árvore sem a versão vulnerável ou mitigação comprovada; requisição comprimida inválida rejeitada sem encerrar o processo.

### PAY-03 — Alta operacional: rotina de backup não cobre o banco do gateway

**Evidência:** `os-system-web/scripts/operacao/core.cjs:37–41`. O último manifesto examinado contém 77 tabelas do SystemOS e seus objetos; não contém `payments`, `provider_settlements`, `checkout_notifications` ou `payment_operations` da base separada na porta 55439. Foram encontradas quatro cópias pontuais `.dump` na área local do gateway; isso não demonstra rotina de backup criptografado, exportação externa ou restauração conjunta.

Perder esse volume pode eliminar o vínculo de transação, deduplicação e pistas necessárias para conciliar cobranças. Restaurar somente o SystemOS não recompõe esses dados.

**Correção:** incluir base, migrações, configuração recuperável e procedimento de recuperação de chaves do gateway na rotina cifrada, mantendo chave separada e preservando a independência dos bancos. Validar restauração conjunta em ambiente isolado, com corte consistente e recuperação sem reenviar cobranças. A mera presença de um dump não é prova de restauração.

### PAY-04 — Média: limites compartilhados prejudicam webhooks e consultas legítimas

**Evidência:** `src/http/server.ts:25–40`, `src/http/authentication.ts:22–37`; proxy em `os-system-web/apps/web/next.config.mjs`.

O gateway vê o Next como origem loopback e usa `trustProxy:false`. Na reprodução local, 120 corpos inválidos consumiram a janela inteira e a próxima notificação válida recebeu 429. Na composição atual, tráfego público encaminhado pelo mesmo proxy divide esse bucket. A borda pode reduzir a exposição, mas sua resistência a esse cenário não foi comprovada.

O bucket privado é separado — o ataque ao webhook não consome diretamente a quota de leitura. Porém a credencial privada tem limite de 60 requisições/minuto compartilhado por todos os clientes. Cinco apps consultando a cada cinco segundos já atingem 60, antes do worker e do monitor.

**Correção:** quotas e prioridades adequadas para ingress público, leitura, criação e recuperação; identificar origem somente por uma cadeia de proxy explicitamente confiável, sem confiar cegamente em `X-Forwarded-For`; aplicar backoff e dimensionar consultas. Não reintroduzir as antigas quotas vitalícias de testes removidas a pedido do usuário.

### PAY-05 — Média: monitor pode informar normalidade com pendências omitidas

**Evidência:** `src/application/payment-operations.ts:17–42` e `os-system-web/scripts/operacao/ligado-pay.cjs:2–5`.

O relatório examina apenas os cem primeiros registros elegíveis. O consumidor ignora `truncated`. No teste, cem pendências recentes sem alerta precederam um registro que exigia conferência: o gateway informou truncamento, mas o monitor retornou zero alertas.

Avisos públicos de devolução/cancelamento também ficam como pendência não verificada e não há encerramento operacional implementado. Isso pode manter alertas antigos e ocupar a amostra, agravando a visibilidade.

**Correção:** agregar todos os contadores de risco ou percorrer páginas; truncamento deve produzir estado incompleto/alerta, nunca saudável; separar avisos não verificados de ocorrências confirmadas e permitir conclusão auditada, sem apagar o histórico.

### PAY-06 — Média: leitura síncrona de segredo bloqueia a API

**Evidência:** `os-system-web/apps/api/src/pagamentos/ligado-pay.config.ts:30–39` e `ligado-pay.client.ts:131`.

Cada chamada ao gateway inicia PowerShell por `execFileSync` para abrir o token DPAPI. Em processo de diagnóstico, três leituras levaram 936 ms, e um timer não pôde executar durante esse período. É bloqueio do event loop, não somente espera assíncrona de rede. O valor é uma medição pontual, não benchmark de capacidade.

**Condição:** chamadas autorizadas que alcancem o gateway; um visitante anônimo não recebe esse acesso. Com concorrência, o custo impacta outras rotas da mesma API.

**Correção:** carga protegida e validada no início do processo, ou carregador assíncrono com cache e rotação explícita. Não registrar o segredo nem criar fallback em texto puro.

### PAY-07 — Média: mesma identidade operacional reduz a separação de segredos

**Evidência:** os processos escutando em 3001 e 3305 pertencem ao mesmo SID Windows, confirmado sem publicar o SID. A chave bancária usa DPAPI CurrentUser, e uma leitura autorizada feita nesse contexto consegue abri-la. ACL do arquivo de configuração não concedeu leitura a grupos amplos.

Os bancos e as permissões HTTP estão separados, mas um comprometimento de execução no SystemOS sob essa conta pode alcançar arquivos e segredos do gateway. DPAPI não constitui isolamento entre dois processos da mesma identidade.

**Condição:** comprometimento local ou de execução do processo; não foi encontrada leitura anônima direta desses arquivos.

**Correção:** identidades de serviço distintas, permissões de arquivos restritas por serviço e administração do banco separada. A API consumidora deve acessar apenas sua credencial de integração, sem acesso à chave bancária ou ao administrador do gateway.

### PAY-08 — Média operacional: devolução confirmada fora do sistema não tem baixa implementada

**Evidência:** `src/application/checkout-service.ts:49`, `src/application/payment-operations.ts:87–91`, `os-system-web/apps/api/src/pagamentos/ligado-pay-os.service.ts:260` e exclusão de pagamentos aprovados do worker.

Um aviso de devolução não verificado preserva `PAID_PIX/APROVADO` — comportamento correto para não confiar em uma notificação falsa. Entretanto falta o caminho posterior de conciliação de uma devolução realmente executada na InfinitePay. A OS pode continuar sendo considerada quitada após a devolução bancária.

**Correção:** implementar baixa financeira mediante confirmação apropriada e trilha auditada, com identificação da transação e valor. A execução da devolução/cancelamento deve continuar exclusivamente na conta InfinitePay, conforme determinação do titular. Não transformar aviso, redirect ou comprovante isolado em verdade financeira.

## Dependências: classificação e aplicabilidade

`npm audit` do gateway: zero alertas. SystemOS: seis pacotes sinalizados — um crítico, quatro altos e um moderado; essa contagem inclui propagação de dependências e não representa seis explorações confirmadas.

| Componente | Situação encontrada | Aplicabilidade examinada |
| --- | --- | --- |
| body-parser 2.3.0 | Alta, correção 2.4.0 | Parser padrão ativo; achado PAY-02. |
| Next 15.5.27 | Crítica por otimização de imagem/SVG | O aviso [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw) exige Linux/glibc. A execução observada é Windows; não classificada como RCE demonstrada nesta instalação. Atualizar para 15.5.28 antes de uma implantação Linux. |
| Next 15.5.27 | Alta por Server Actions | [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) exige ao menos uma Server Action. Não foram encontradas diretivas `use server` na aplicação; atualizar por higiene e evolução segura. |
| multer 2.4.0 | Alta por filtro assíncrono | [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) exige `fileFilter` assíncrono. Não foi encontrado filtro dessa forma. O override fixa versão anterior à correção 2.5.0. |
| brace-expansion / fast-uri | Recursão, custo e normalização | Alertas em versões instaladas; não foi demonstrado que entrada de pagamento alcance as funções vulneráveis. Atualizar sem prometer que todos os alertas são exploráveis neste fluxo. |

No Android, OSV retornou JUnit 4.13, Play Services Basement 17.0.0 e BouncyCastle 1.80 nos diferentes lockfiles. O app seleciona Basement 18.4.0, fora da versão afetada; BouncyCastle ficou em testes. JUnit 4.13 aparece no runtime do app, mas a advisory [GHSA-269g-pwp5-87pp](https://github.com/advisories/GHSA-269g-pwp5-87pp) depende de uso de `TemporaryFolder` com dados sensíveis em diretório temporário compartilhado, o que não foi identificado no fluxo. Remover dependência de testes indevida do runtime ou atualizar o transitivo; não descrever isso como roubo remoto de tokens confirmado.

## Hipóteses afastadas e pontos para reforçar

- **Correlação da InfinitePay:** o adaptador não compara localmente `slug` ao link salvo e tolera ausência de identificadores no retorno. O simulador demonstrou essa dependência de confiança. Contudo a API real retornou `paid:false` tanto para outro UUID quanto para outro pedido existente do mesmo valor; fatura errada também não confirmou. Assim, fraude por mistura de pagamentos não foi reproduzida. Validar o slug conhecido antes da consulta continua recomendável como defesa adicional e auxilia PAY-01.
- **Webhook com `paid:true` inventado:** não é prova financeira; valor, recibo e campos do pagador são descartados, e o provedor é consultado. Avisos de devolução/cancelamento não movimentam dinheiro.
- **IDOR e troca de recebedor:** autorização por organização/cliente/OS no SystemOS e por aplicação/recebedor/ambiente/conta no gateway recusaram acessos indevidos nos testes. DTO não aceita valor, recebedor ou URL arbitrária fornecidos pelo cliente.
- **Duplicação:** reserva durável antes do envio, locks, índice de tentativa ativa e settlement/evento únicos preservam incerteza e impedem repetição da cobrança nos cenários executados.
- **URLs e SSRF:** transporte bancário tem origem e caminhos fixos, sem redirects, com timeout e limite de resposta. Links do checkout passam por validação HTTPS/host/caminho no servidor e clientes. `receipt_url` não é buscada pelo backend.
- **Superfície pública:** 3305 e 55439 escutam em loopback; o papel de execução do gateway não é superuser e não cria schema/roles/bancos. Tem `rolbypassrls=false`, o que não implica que exista RLS nas tabelas. Rotas públicas equivalentes a operações/criação do gateway retornaram 404; disponibilidade da API do cliente sem sessão retornou 401.
- **App:** requisições financeiras validam família de sessão, geração e OS selecionada. InfinitePay abre no navegador e não recebe a credencial do gateway. Não há armazenamento de cartão pelo Ligado Pay.
- **Legado desativado:** Mercado Pago está desabilitado na configuração observada. Seu desafio 3DS aceita qualquer HTTPS no backend/WebView; antes de reativar, validar a origem ACS conforme suporte do provedor. Não foi demonstrado controle dessa URL por um cliente comum.
- **Distribuição Android:** o APK instalado é interno/debug, com release bloqueada. Não tratá-lo como distribuição pública homologada; a próxima etapa externa exige build de produção e revisão do transporte de dependências.

## Validações e limites

Executados nesta auditoria: 30 testes unitários e 21 integrados do gateway; contrato OpenAPI; 28 testes de vínculo/HTTP/sessão/CSRF/concorrência no SystemOS em banco descartável; 25 cenários de regressão do provedor legado; 221 unitários do SystemOS, com cinco integrações opcionais não executadas pelo comando unitário; diagnóstico de fila/rate limit/monitor e quatro consultas oficiais de leitura.

O caso adicional de E2E HTTP entre os dois processos foi excluído nesta rodada porque utiliza a porta 3305 em operação; o gateway real não foi parado. O teste HTTP de sessão nativa/web e as provas de banco/serviço foram executados. A evidência Android de 132 testes e lint sem erros é da compilação instalada anterior a esta auditoria, não de uma nova compilação nesta rodada.

Não houve teste de invasão no provedor, carga contra produção, prova de RCE, análise forense, revisão das regras da conta Cloudflare, revalidação de login Google real, desafio 3DS real nem teste de devolução real. A segurança interna da InfinitePay não pode ser certificada pela revisão deste código. A auditoria não garante ausência de outras vulnerabilidades.

## Ordem de correção e evidências

1. Corrigir PAY-02 e PAY-01, com regressão e publicação controlada.
2. Integrar e testar recuperação do banco do gateway (PAY-03).
3. Corrigir quotas, monitor e carregamento do segredo (PAY-04 a PAY-06).
4. Separar identidades e concluir conciliação de devoluções (PAY-07/08), mantendo operações bancárias na InfinitePay.
5. Atualizar demais dependências e fechar condições de distribuição/3DS antes de habilitar recursos adicionais.

Artefatos: `evidencias/auditoria-integracao-2026-10-26.json`, `evidencias/auditoria-vinculo-provedor-2026-10-26.json`, relatório Maven em `os_ligado_app/evidencias/auditoria-dependencias-2026-10-26.json` e sumário no SystemOS. Saídas brutas de testes e `npm audit` ficam nas pastas locais ignoradas. O diagnóstico reproduz achados no código atual; após a remediação, suas expectativas devem ser convertidas em testes que exijam a rejeição/recuperação segura.
