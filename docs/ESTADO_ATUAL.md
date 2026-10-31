# Estado atual — Ligado Pay

Consolidado com atualização em 30/10/2026, com base nas publicações, fontes e evidências registradas. Esta revisão não fez chamadas financeiras reais, migrações operacionais ou publicação. As migrações dos testes foram aplicadas somente nos bancos sintéticos indicados abaixo.

## Escopo e integração

API privada de gateway de pagamentos: TypeScript/Fastify e PostgreSQL próprio, sem tabelas compartilhadas com consumidores. Não contém OS, orçamento, manutenção, loja, CRM, frontend ou custódia própria de dinheiro. SystemOS calcula/autoriza a operação e envia referência opaca; portal e Android passam por seu backend.

InfinitePay é o provedor integrado. Pix usa o PSP contratado, não uma API de cobrança direta do Banco Central. O produto fornece checkout hospedado com Pix e cartão; não promete QR direto nem equivalência de homologação entre modalidades.

## Publicado e verificado anteriormente

- Produção privada (`private-production`, NODE_ENV=production), origem loopback e prontidão autenticada implantadas sob LigadoPayGateway, separado de LigadoSystemOS.
- Autorização por aplicação/recebedor/ambiente, referência única, intenção durável, idempotência, centavos inteiros e eventos financeiros transacionais.
- Notificações encaminhadas por proxy HMAC com chave independente, janela de tempo e limites de corpo/fila. A assinatura protege o encaminhamento local; não constitui assinatura da InfinitePay. Consulta autenticada ao provedor confirma o estado financeiro.
- Recuperação e reconsulta de pagamentos existentes; retorno do navegador é somente uma pista. App retoma consulta ao voltar do banco, conforme implementação do consumidor.
- Rotação de Bearer publicada **e troca operacional concluída**, com credencial anterior recusada e leitura da nova conferida. [Procedimento/evidência](ROTACAO_CREDENCIAIS.md).
- Testes Pix reais já pagos/confirmados registrados no histórico. Não recriar cobranças, apagar marcadores nem repetir emissão como verificação documental.

Revalidação posterior em 29/10/2026: 36 testes unitários, 26 integrados e contrato OpenAPI aprovados novamente, sem chamadas reais ao provedor. O consumidor também passou em 30 testes integrados com bancos separados e adaptador de transporte sintético, mais 25 cenários legados. Foram corrigidos isolamento de ambiente e colisão de porta apenas no executor de testes SystemOS; o gateway operacional não foi alterado. [Resultados e limites](../../os-system-web/docs/VALIDACAO_JORNADAS_2026-10-29.md). Os builds posteriores do SystemOS e o APK atual pertencem aos consumidores; não significam alteração do código financeiro do gateway. [Estado SystemOS](../../os-system-web/docs/ESTADO_ATUAL.md) e [Android](../../os_ligado_app/docs/ESTADO_ATUAL.md).

## Operação e limites

Devolução/cancelamento do dinheiro são executados exclusivamente na conta InfinitePay. Intenção administrativa e conciliação de devolução já conferida não movimentam dinheiro. [Operação Pix](operacao-pix.md).

Simulação continua sendo o padrão local e criação real exige configuração explícita. A operação privada publicada não deve ser confundida com a configuração local desligada por padrão ou com antigos limites de teste. Cartão disponível no checkout não comprova homologação financeira completa de cartão/3DS. Não abrir cadastro público de recebedores.

Backups incluem o banco próprio do gateway e recuperação protegida. Restaurações isoladas anteriores passaram; DPAPI exige reprovisionamento para outra identidade/host. Confirmação externa da cópia cifrada permanece separada da cópia em pasta local do Drive. Usuário pediu não sincronizar agora; nenhuma sincronização realizada nesta revisão.

## Retomada e preservação

Consultar [produção privada](PRODUCAO_PRIVADA.md), [arquitetura](arquitetura.md), [ameaças](modelo-ameacas.md), [InfinitePay](infinitepay.md) e [histórico de retomada](retomada.md). Datas e hashes antigos nesses históricos são marcos, não a seleção atual de runtime.

A limpeza de 29/10 não encontrou resíduos seguros que exigissem remoção neste repositório. `.local`, marcadores financeiros, `dist`, dependências, credenciais e dados foram preservados. A rodada altera documentação, sem modificar configuração financeira.

[Índice completo da documentação](INDICE.md).

## Estabilização de 30/10/2026

Contrato oficial do checkout reconferido: o cartão permanece disponível no link. A confirmação automática do gateway continua exclusivamente Pix; cartão exige conferência e não é convertido em PAID_PIX. Avisos anteriores ao checkout foram corrigidos nos consumidores web/Android; política do SystemOS passou a identificar InfinitePay/Ligado Pay e Mercado Pago quando habilitado. O código/configuração financeira do gateway não mudou nesta rodada.

Integração SystemOS–gateway reexecutada em bancos descartáveis distintos no servidor de testes: 30 testes e 25 cenários legados aprovados, com transporte do provedor sintético. O executor foi corrigido para não depender da antiga porta 25432 desligada; aceita somente destinos de teste explicitamente limitados. Nenhuma cobrança, devolução ou consulta financeira real nesta etapa. Plano/evidência coordenados em ../../os-system-web/docs/ESTABILIZACAO_SISTEMAS_2026-10-30.md.
