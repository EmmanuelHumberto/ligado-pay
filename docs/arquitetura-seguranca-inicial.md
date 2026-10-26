# Arquitetura e segurança da primeira entrega

Decisão do usuário em 25/10/2026: priorizar a segurança da infraestrutura; gateway exclusivamente API; primeiro consumidor é o SystemOS na aba de pagamentos da aprovação de serviços, em portal web e app. Este documento contém requisitos, não comprovação de controles implementados.

## Fluxo e fronteiras

1. Portal ou app envia a intenção ao backend do SystemOS usando a sessão do cliente.
2. SystemOS valida titularidade, permissões, decisões do orçamento, versão, saldo e elegibilidade. Valor e moeda são calculados no servidor. Aprovação comercial e confirmação financeira são operações distintas.
3. Backend solicita a cobrança ao Ligado Pay com identidade de aplicação, referência opaca e chave de idempotência. O cliente não escolhe livremente a conta recebedora.
4. Gateway autoriza aplicação, recebedor, ambiente e operação, persiste a intenção e usa um adaptador de provedor habilitado.
5. Portal e app apresentam QR dinâmico/copia e cola com expiração ou o fluxo autorizado do provedor. Credenciais privadas nunca passam pelo dispositivo. SDK de tokenização, se utilizado, comunica dados de cartão diretamente ao provedor.
6. Notificação validada aciona consulta ao provedor. Gateway confere conta, referência, valor, moeda e estado, registra a transição e um evento persistente.
7. SystemOS recebe evento autenticado e deduplicado ou recupera o estado por consulta. Seus próprios controles decidem a atualização da aplicação. Reconciliação periódica recupera notificações perdidas.

O Ligado Pay não autentica a sessão comercial do cliente e não consulta tabelas de OS/orçamento. Autentica o servidor integrador. É responsabilidade do SystemOS impedir acesso de um cliente às cobranças de outro.

## Requisitos de infraestrutura

- Serviço com identidade e banco próprios. Papel de banco com privilégios mínimos, sem acesso aos bancos do SystemOS. Migrações por identidade separada, versionadas e verificáveis.
- Banco, administração e tarefas não expostos à internet. Acesso administrativo por rede restrita e MFA. API de negócio acessível somente a backends autorizados; rota pública de webhook segregada, sem privilégios de criação ou estorno.
- TLS nas conexões. Autenticação entre serviços preferencialmente com mTLS e credenciais curtas e restritas, conforme suporte operacional. Não confiar apenas em IP, CORS, hostname ou cabeçalhos encaminhados pelo proxy.
- Para provedores que exigem mTLS no webhook, comprovar a validação do certificado cliente no ponto de entrada. Proxy/túnel não pode eliminar essa garantia; não desabilitar a validação para facilitar a publicação.
- Segredos em armazenamento protegido com controle de acesso, rotação e auditoria; chave de criptografia separada dos dados e dos backups. Falha na configuração impede a subida em produção. Sem credenciais padrão.
- Processo sem privilégios administrativos, dependências e imagens fixadas, atualização de segurança, limites de CPU/memória/conexões e saída de rede restrita aos serviços necessários.
- Backups criptografados fora do host, chave de recuperação separada e testes reais de restauração. Recuperação não pode reexecutar cobranças já realizadas.
- Métricas e alertas para falha de autenticação, mudanças de recebedor, erros de assinatura, divergências, filas atrasadas e aumento de tentativas. Não registrar tokens, CVV, PAN ou payloads pessoais integrais.

## Requisitos contra fraude e falhas

- Sem onboarding público, custodiar recursos, saques, transferências arbitrárias ou destinatário informado pelo cliente. Somente contas próprias previamente autorizadas nesta etapa.
- Autorização em toda operação e objeto, com isolamento por aplicação, recebedor e ambiente. Estorno possui permissão própria; mudança de recebedor exige procedimento administrativo forte e auditado.
- Limites explícitos por cobrança, período, aplicação e conta; configuração ausente não significa ilimitado. Suspensão de novas operações preserva consulta, conciliação e evidências.
- Idempotência persistente com unicidade, bloqueio transacional e comparação do conteúdo. Reutilizar chave com conteúdo diferente resulta em conflito. Consultar antes de repetir uma operação cujo resultado é incerto.
- Não trocar automaticamente de provedor após timeout ou recusa: a tentativa anterior pode ter sido processada. Controle concorrente de saldo autorizado e montante pendente impede cobranças duplicadas entre meios/provedores.
- Reembolso limitado ao valor efetivamente disponível e vinculado à transação original, sem receber outra chave Pix como destino. Notificação isolada, screenshot ou retorno do navegador nunca prova pagamento.
- Webhooks com autenticidade conforme contrato do provedor, limites de corpo e frequência, defesa contra replay e gravação durável antes da confirmação de recebimento. Evento suspeito não altera estado financeiro.
- Eventos de saída assinados, identificados e versionados, com reenvio limitado e recuperação. Destinos previamente autorizados, sem redirects, protegidos contra SSRF inclusive por DNS; não aceitar URL de callback arbitrária em cada cobrança.
- Retenção definida para registros financeiros, notificações e auditoria. Trilha com proteção contra alteração e cópia independente; não prometer imutabilidade absoluta diante de administrador do host.

## Sequência e critérios verificáveis

1. Definir contrato versionado, estados financeiros, modelo de ameaças e capacidades por provedor. Nenhum acoplamento às tabelas de OS.
2. Implementar autenticação, isolamento, persistência, idempotência e adaptador simulado. Testar acesso cruzado, dupla submissão concorrente, chave reutilizada e falhas transacionais.
3. Integrar um provedor em homologação. Testar assinatura inválida, duplicidade, atraso, consulta indisponível, timeout após criação, divergência de valor/recebedor, devolução e reconciliação.
4. Integrar SystemOS e espelhar apresentação/estados no portal e app. Testar cliente indevido, orçamento alterado, saldo concorrente e recuperação após indisponibilidade.
5. Demonstrar restauração, rotação, revogação, suspensão de operações, monitoramento e recuperação de filas. Revisão de segurança independente antes de habilitar produção.
6. Habilitar cada provedor individualmente, com contrato, credenciais e evidências. Preservar pagamentos antigos e seus webhooks durante qualquer migração.

## Estado atual

Base local implementada com API, PostgreSQL exclusivo, simulador e testes; ver [arquitetura executável](arquitetura.md) para os controles efetivos e suas limitações. Integrações reais, infraestrutura de produção e homologação financeira ainda pendentes. Não houve migração de pagamentos, alteração de recebedor, cadastro de webhook ou mudança em produção.

Referências técnicas: [OWASP REST](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html), [webhooks](https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Cheat_Sheet.html), [SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
