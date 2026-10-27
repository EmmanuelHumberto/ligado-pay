# Resultado das correções da integração

Referência: AUDITORIA_INTEGRACAO_2026-10-26.md. Situação registrada em 27/10/2026 UTC. Nenhuma cobrança, devolução ou cancelamento real foi executado nesta rodada.

| Achado | Situação verificada |
|---|---|
| PAY-01 | Corrigido: pistas limitadas/substituíveis, sem esgotamento vitalício, reconsulta direta e recuperação privada prioritária. Invoice conhecido é vinculado localmente antes de consultar o provedor. |
| PAY-02 | Corrigido: Next 15.5.28, body-parser 2.4.0, multer 2.5.0, fast-uri 3.1.9 e correções de brace-expansion. npm audit sem alertas nos dois projetos Node. API rejeita conteúdo comprimido, confirmado com HTTP 415. |
| PAY-03 | Corrigido no fluxo operacional: banco exclusivo do gateway e material de recuperação incluídos no pacote privado, pausa dos dois escritores, restauração em bancos isolados e exportação AES-256-GCM verificada. Upload externo continua manual. |
| PAY-04 | Corrigido: proxy com metadados HMAC, IP autenticado pelo encaminhamento, cotas por origem e por operação privada. Origem somente loopback. |
| PAY-05 | Corrigido: agregado completo, detalhes limitados, monitor recusa truncamento sem agregado e pendências encerráveis com registro imutável separado. |
| PAY-06 | Corrigido: DPAPI assíncrono com cache, leitura simultânea coalescida e invalidação por alteração do arquivo. Teste confirma que o temporizador do event loop avança durante a leitura. |
| PAY-07 | Isolamento aplicado: API/Web em LigadoSystemOS e gateway em LigadoPayGateway, código protegido e segredos por identidade. Reinício manual das tarefas, backup e restauração isolada passaram. Falta concluir o fluxo administrativo para futuras publicações; publicador antigo bloqueado. |
| PAY-08 | Implementada conciliação MANUAL privilegiada: somente após conferência na conta; runtime não insere registros de devolução. Histórico, duplicidade, soma máxima, sincronização parcial/total e exibição web/Android testados. Não há verificação automática de devolução pela API do provedor nesta entrega. |

## Validação

- Gateway: 31 testes unitários e 25 de integração em banco dedicado/descartável; regressão de fila, invoice, proxy e monitor.
- SystemOS: 223 testes unitários aprovados e cinco ignorados, incluindo o teste DPAPI; 29 testes de integração aprovados. Build API/web publicado `e2866253-0d5c-48bc-8311-6492f6127b8a`.
- Verificação pública: API/web saudáveis; webhook sintético para referência inexistente aceito pelo proxy assinado, sem consulta financeira; conteúdo comprimido recusado com 415.
- Backup: 77 tabelas SystemOS, 192 objetos; 11 tabelas gateway. Restauração isolada dos dois bancos e hashes conferidos. Arquivo cifrado gerado na pasta `ecosistema/backups`, chave separada já existente.
- Android: 132 testes JVM, lint com zero erros, APK `OS-Ligado-Seguranca-Pagamentos-2026-10-27-c98de334.apk`. Não instalado: nenhum aparelho apareceu no ADB nesta rodada.

O isolamento de execução foi aplicado; o encerramento operacional ainda exige o fluxo de publicação de novas releases isoladas, a instalação do APK e a cópia externa manual. Recibos, webhook ou retorno do navegador continuam insuficientes para alterar estado financeiro por conta própria.


## Histórico da tentativa inicial do Windows (superado pela ativação abaixo)

A migração administrativa foi tentada. Testes preliminares de negativa de acesso e de escrita passaram, mas as tarefas não concluíram a partida do Node. Os serviços originais voltaram a responder e continuam sob a identidade original; PAY-07 permanece em aberto. Contas e tarefas criadas na tentativa ficaram desativadas. O teste administrativo em portas separadas foi rejeitado pela revisão automática com "blocked by policy". Somente o diagnóstico posterior de leitura foi executado; ele não mudou serviços/contas. O protótipo de instalação não permite nova execução automática até validação.

As correções finais da fila invalidam o lease ao substituir uma pista e respondem 503 quando todos os slots estão em uso, em vez de confirmar recebimento sem persistência. A seleção de pendências operacionais prioriza registros ainda não encerrados.


## Ativação e recuperação verificadas — estado atual

Estado consolidado em 27/10/2026. Este registro substitui as indicações antigas de migração inativa, gateway original ou PAY-07 sem isolamento aplicado. Relatos anteriores são histórico de execução.

API/Web e gateway operam em identidades Windows distintas e não administrativas, com negativas de acesso cruzado e código protegido. Tarefas Ligado Runtime API/Web/Gateway Running após reinício manual; controlador confirmou build e2866253-0d5c-48bc-8311-6492f6127b8a saudável. Job Object acompanha a vida do Node. Homologação HTTP permanece pausada.

Backup de 04:30:51 UTC restaurado em ambiente isolado às 04:33:43 UTC: 77 tabelas SystemOS, 185.735 registros, 192 objetos, além de 11 tabelas do gateway. Hashes/sequências conferidos; produção preservada. Corrigida prontidão do contêiner PostgreSQL para TCP, evitando a instância temporária por socket. Nova cópia AES-256-GCM verificada, sem upload automático.

Fontes, limites de publicação e pendências: `../../os-system-web/docs/ENTREGA_INTEGRADA_2026-10-27.md` e `../../os-system-web/docs/ISOLAMENTO_RUNTIME_WINDOWS.md`. APK c98de334 compilado e não instalado. A API continua exclusivamente gateway de pagamentos, com banco próprio e referências externas opacas; nenhuma regra de OS foi incorporada.
