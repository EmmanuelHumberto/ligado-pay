# Estado atual do Ligado Pay

Atualizado em 31/10/2026. API privada de gateway de pagamentos, sem frontend, regras de OS ou tabelas compartilhadas com consumidores. InfinitePay é o provedor integrado; SystemOS e Android usam o gateway por meio do backend autorizado. [Índice](INDICE.md) e [painel dos três sistemas](../../os-system-web/docs/ESTADO_ECOSSISTEMA.md).

## Operação vigente

Produção privada sob LigadoPayGateway, separada de LigadoSystemOS, com private-production e NODE_ENV=production. Fonte identificada no manifesto coordenado: `4ce591955f9ce0edf6b9771cc955f7f825a07e4c`. A publicação SystemOS de 31/10 manteve o código e a configuração financeira do gateway. [Publicação coordenada](../../os-system-web/evidencias/pdf-conclusao-publicacao-2026-10-31.json).

Pix tem confirmação automática por consulta ao provedor. O checkout pode oferecer cartão, mas isso não comprova liquidação automática nem homologação de cartão/3DS; cartão permanece em conferência. Devoluções/cancelamentos do dinheiro são feitos na conta InfinitePay. Intenções e registros internos não movimentam dinheiro por si só. [Operação Pix](operacao-pix.md).

Credenciais têm escopo por aplicação/recebedor e ciclo de validade/revogação. Alteração do arquivo exige recarga pelo reinício; datas já carregadas são avaliadas por autenticação. Não repetir teste Pix real já pago nem remover marcadores de tentativa para recriá-lo. [Retomada histórica](retomada.md) e [rotação](ROTACAO_CREDENCIAIS.md).

## Verificações

36 testes unitários, 26 integrados e contrato aprovados na revalidação de 29/10; integração dos consumidores validada em bancos separados com provedor sintético. CI remoto aprovado para a fonte acima: [execução](https://github.com/EmmanuelHumberto/ligado-pay/actions/runs/41152640294). O backup de 31/10 restaurou o banco do gateway em host Linux separado, sem iniciar aplicação ou provedor. [Recuperação](../../os-system-web/evidencias/recuperacao-linux-2026-10-31.json).

## Pendências

Retirar composição local legada após inventário de consumidores; revisar procedimento de recarga de revogação; concluir homologação de cartão/3DS e recuperação DPAPI em outro Windows. Confirmar cópia externa do backup atual permanece separado da recuperação do kit de chave; sincronização continua suspensa por orientação do usuário.

A [segunda crítica](../../os-system-web/docs/REVISAO_CRITICA_STATUS.md) foi analisada. Nenhuma nova correção financeira ou de segurança foi implementada em consequência dela. Teto e revisão de recebimentos manuais pertencem ao SystemOS, não ao gateway.

## Histórico

[Estado anterior preservado](HISTORICO_ESTADO_ATE_2026-10-31.md). Guias datados registram execução e propostas da época. Esta consolidação prevalece para o estado atual; não habilita cobranças, migra pagamentos ou abre cadastro público de recebedores.
