# Auditoria de isolamento — 12/11/2026

**13/11, 15h34:** isolamento estrutural Pay/banco publicado em bridges próprias.
Banco sem porta no host, contenção de tráfego roteado e entre membros da bridge,
consumidores SystemOS/Store e backup/restauração aprovados. As notas históricas
abaixo não representam mais a topologia ativa do Pay.
[Publicação e pendências do ecossistema](../../os-system-web/docs/PAY_REDE_PRIVADA_PUBLICACAO_2026-11-13.md).

Atualização de 13/11: [entrada Linux das notificações InfinitePay corrigida](NOTIFICATION_INGRESS_LINUX_2026-11-13.md), com receptor separado e sem credenciais bancárias. Acesso público recuperado após corrigir uma falha de permissão do publicador. Aviso sintético para pagamento inexistente aceito sem criar registro ou fila; pagamento real não repetido.

Atualização às **21h42**: o processo Pay recebeu contenção nftables por UID. Conserva o próprio PostgreSQL e HTTPS/DNS necessários, mas não alcança os bancos SystemOS, Store e identidade. Web SystemOS não alcança o gateway diretamente; API SystemOS e relay autorizado da Store continuam funcionando. Imagem do gateway preservada, sem cobrança real de teste. [Validação e limites da mitigação ISO-02](../../os-system-web/docs/CONTENCAO_RUNTIME_2026-11-12.md). Rede host ainda precisa de migração estrutural.

**Achado crítico corrigido em 12/11/2026 às 21h03:** o PostgreSQL Pay aceitava `trust` para TCP loopback e compartilha a rede do host com o SystemOS. A auditoria comprovou autenticação sem senha como superusuário do banco Pay a partir do contêiner web SystemOS, consultando apenas metadados em leitura. Não houve alteração de pagamento ou chamada financeira real. Agora TCP exige SCRAM para o papel próprio e recusa administração; o canal Unix privado preserva o backup.

O isolamento por aplicação na API não contém acesso direto como superusuário ao banco. A autenticação TCP foi corrigida com validação das credenciais, ensaio isolado e backup/restauração. A separação de redes permanece pendente. [Entrega da correção](../../os-system-web/docs/CORRECAO_AUTH_POSTGRES_2026-11-12.md).

[Relatório central, provas, limites e plano de correção](../../os-system-web/docs/AUDITORIA_ISOLAMENTO_ECOSISTEMA_2026-11-12.md). Os 39 testes unitários do Pay passaram; isso não invalida o achado de infraestrutura.
