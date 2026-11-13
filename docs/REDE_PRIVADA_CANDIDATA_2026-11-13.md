# Rede privada do gateway — candidata de 13/11/2026

**Atualização:** publicada às 15h34 de 13/11, com proteção adicional entre membros
da bridge, consumidores e backups conferidos. As notas abaixo registram a etapa
anterior. [Estado ativo e provas](../../os-system-web/docs/PAY_REDE_PRIVADA_PUBLICACAO_2026-11-13.md).

Implementado o perfil opcional `private-container-v1`, validado somente em
produção privada, com destino fixo `pay-db:55439/ligado_pay_local`, papel
`ligado_pay_runtime` e escuta do gateway em porta 3305. O perfil anterior em
loopback permanece compatível. Conta recebedora, cotas, permissões e decisões
financeiras não foram alteradas.

**Não publicado.** A produção continua na imagem anterior, com contenção de rede
por UID. A candidata foi compilada e testada em redes descartáveis, com dados
sintéticos e com cópia restaurada do banco Pay, sem credenciais do provedor ou
chamadas financeiras. O retorno à imagem anterior passou na mesma cópia e os
hashes dos dados de negócio foram preservados.

Passaram 42 testes de código e a conferência do contrato OpenAPI. Os testes do
receptor separado mantêm sete aprovações e um caso Linux não executado no Windows;
isso não equivale a cobertura completa de segurança.

Configuração, contenção de bridge, guard PostgreSQL, evidências, limites e critérios
para a publicação estão no
[registro operacional SystemOS](../../os-system-web/docs/PAY_REDE_PRIVADA_CANDIDATA_2026-11-13.md).

Não ativar o perfil em rede host. Não reutilizar banco, senha, credencial de serviço
ou tabelas do SystemOS/Store. A mudança permanece restrita ao gateway de pagamentos.
