# Estado atual do Ligado Pay

Às 17h32 de 13/11/2026, web SystemOS isolada e encaminhamento DNS pelo host
corrigido na web/banco/arquivos. Consumidores Pay revalidados; imagem,
credenciais e regras financeiras preservadas.
[Estado vigente](../../os-system-web/docs/SYSTEMOS_WEB_REDE_PRIVADA_2026-11-13.md).

Às 17h17 de 13/11/2026, banco/arquivos SystemOS foram separados em bridges
próprias. Pay e suas credenciais/imagens foram preservados; prontidão autenticada,
notificações e conexão da Store passaram novamente, sem operação financeira.
[Publicação e recuperação verificadas](../../os-system-web/docs/SYSTEMOS_DADOS_REDES_PRIVADAS_2026-11-13.md).

Atualizado em 13/11/2026. API privada de gateway de pagamentos, sem frontend, regras de OS ou tabelas compartilhadas com consumidores. InfinitePay é o provedor integrado; SystemOS e Android usam o gateway por meio do backend autorizado. [Índice](INDICE.md) e [painel dos três sistemas](../../os-system-web/docs/ESTADO_ECOSSISTEMA.md).

Pay e PostgreSQL Pay publicados em bridges próprias às 15h34 de 13/11, mantendo
os consumidores e a API privada em loopback. Backup/restauração antes/depois e
verificações públicas aprovados; sem pagamento de teste.
[Entrega ativa e limites](../../os-system-web/docs/PAY_REDE_PRIVADA_PUBLICACAO_2026-11-13.md).

Produção privada migrada para o VPS Debian 13 em 03/11, junto ao SystemOS, com banco, papel e UID separados. Escritores Windows desativados; dados legados preservados. Backup de produção Linux, restauração isolada e cópia cifrada externa conferidos. [Corte e evidências](../../os-system-web/docs/VPS_PRODUCAO_2026-11-03.md). A etapa sintética anterior permanece em [VPS Linux](VPS_LINUX.md).

## Operação vigente

Produção em `ligado-production-gateway-1`, UID `10003:10003`, modo private-production e NODE_ENV=production, perfil `private-container-v1`. Imagem `sha256:23fd54fc83602e76320acc1c3f805db03ca1bb05ebc61a57d3f5fa394c59d9ee`; banco `ligado_pay_local` somente na bridge própria, em `pay-db:55439`, sob `ligado_pay_runtime` sem superusuário/bypass. A API publicada em `127.0.0.1:3305` permanece privada. Configuração da aplicação/recebedor, chaves, idempotência e dados existentes foram preservados; não foi criada cobrança/devolução para validar o corte. Os manifestos Windows e imagens anteriores são históricos.

Pix tem confirmação automática por consulta ao provedor. O checkout pode oferecer cartão, mas isso não comprova liquidação automática nem homologação de cartão/3DS; cartão permanece em conferência. Devoluções/cancelamentos do dinheiro são feitos na conta InfinitePay. Intenções e registros internos não movimentam dinheiro por si só. [Operação Pix](operacao-pix.md).

Credenciais têm escopo por aplicação/recebedor e ciclo de validade/revogação. Alteração do arquivo exige recarga pelo reinício; datas já carregadas são avaliadas por autenticação. Não repetir teste Pix real já pago nem remover marcadores de tentativa para recriá-lo. [Retomada histórica](retomada.md) e [rotação](ROTACAO_CREDENCIAIS.md).

## Verificações

36 testes unitários, 26 integrados e contrato aprovados na revalidação de 29/10; consumidores em bancos separados com provedor sintético. CI histórico: [execução](https://github.com/EmmanuelHumberto/ligado-pay/actions/runs/41152640294). Na migração, 23 verificações das imagens candidatas passaram, incluindo saúde autenticada e leitura de pagamento correspondente ao snapshot. O monitor final confirma gateway e backup/restauração/cópia externa de produção. A imagem do usuário mostra o pagamento anterior no portal; não se repetiu o teste de R$ 1,00. [Validação final](../../os-system-web/evidencias/vps-validacao-restaurada-final-2026-11-03.json) e [produção](../../os-system-web/evidencias/vps-producao-final-2026-11-03.json).

## Pendências

Composição Windows preservada e escritores desativados. Retorno exige conciliar dados Linux. Três alertas anteriores permanecem (`MISSING_PROVIDER_CORRELATION`, `EXPIRED_UNCONFIRMED`), sem alteração dos estados para eliminá-los. Revisão de revogação, cartão/3DS e recuperação DPAPI em outro Windows mantêm seus limites. Cópia externa do primeiro backup Linux foi conferida; recuperação independente das chaves é critério separado. Drive continua sem sincronização automática.

A [segunda crítica](../../os-system-web/docs/REVISAO_CRITICA_STATUS.md) foi analisada. Nenhuma nova correção financeira ou de segurança foi implementada em consequência dela. Teto e revisão de recebimentos manuais pertencem ao SystemOS, não ao gateway.

## Histórico

[Estado anterior preservado](HISTORICO_ESTADO_ATE_2026-10-31.md). Guias datados registram execução e propostas da época. Esta consolidação prevalece para o estado atual; não habilita cobranças, migra pagamentos ou abre cadastro público de recebedores.
