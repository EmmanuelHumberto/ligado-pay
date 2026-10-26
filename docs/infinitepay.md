# Conector InfinitePay em validação de contrato

Prioridade autorizada pelo usuário: avaliar a InfinitePay para receber Pix sem a tarifa informada para Mercado Pago. O usuário ainda vai verificar se a conta permite habilitar Checkout Integrado e criar API Key. Não foi coletada nenhuma credencial.

## Implementado

- Porta `CheckoutConnector` independente de OS, pedidos comerciais e dados de cartão.
- Adaptador HTTP para os endpoints oficiais `/links` e `/payment_check`, com origem fixa `https://api.checkout.infinitepay.io`, chave apenas no header, rejeição de redirects, timeout e limite de 32 KiB para respostas JSON.
- Recebedor/InfiniteTag, limite e endereço de retorno são configuração de servidor. A entrada não escolhe conta, destino HTTP, itens comerciais ou credenciais.
- Solicitação com referência UUID da intenção já reservada, centavos inteiros, descrição genérica, uso único e expiração limitada a 24 horas por política interna. Nenhum nome, CPF, e-mail ou endereço é enviado nesta etapa.
- Validação conservadora do link de retorno: HTTPS, host exato, caminho correspondente ao recebedor, sem usuário/senha, query ou fragmento. Não se segue nenhum link de recibo.
- Consulta autenticada usando referência e identificadores da transação. Campos recebidos por redirect/webhook servem somente como pistas; não confirmam pagamento.
- Observação `PAID_PIX` somente para resposta autenticada `success=true`, `paid=true`, método Pix, valores exatos em centavos e uma parcela. Divergência vira `REVIEW_REQUIRED`; não é tratada como pagamento negado nem como autorização para cobrar novamente.
- Falha de criação resulta em `CREATE_RESULT_UNCERTAIN`. O adaptador não repete a chamada e não inventa que a referência externa seja uma chave de idempotência nativa do provedor.

Os testes usam respostas sintéticas e transporte injetado. O módulo não está ligado a `src/main.ts`, não é aceito pela configuração runtime e não possui endpoint público. A API existente continua exclusivamente simulada. Nenhum link real foi criado, nenhum webhook cadastrado e nenhum pagamento confirmado no gateway por este adaptador.

## Limitações confirmadas na documentação

O produto documentado é checkout hospedado, não uma API de QR Pix direto. A central de ajuda informa que cartão continua disponível. Os resultados do adaptador declaram `exclusivePix=false` e `directQrAvailable=false`; um cartão pago vai para revisão, nunca é apresentado como Pix quitado. Isso impede liberar o produto como exclusivamente Pix nesta etapa.

Existe documentação antiga com InfiniteTag e `webhook_url`; a orientação atual da central inclui API Key, `options` e objeto `webhook`. A chave é exigida pelo nosso adaptador mesmo onde o provedor admite fluxo básico sem ela.

O exemplo público de `payment_check` contém `amount` e `paid_amount` diferentes. Não presumimos que a diferença seja tarifa, juros ou valor líquido. Qualquer diferença vai para revisão até haver definição contratual, especialmente para Pix.

## Hipóteses de contrato ainda não homologadas

- Formato exato da resposta de criação: os normalizadores aceitam candidatos `url`, `checkout_url` ou `link`, recusando campos conflitantes. Esses nomes e o host/caminho do checkout precisam ser confirmados em contrato oficial ou teste autorizado; os fixtures não comprovam a resposta real.
- Formato aceito da API Key, InfiniteTag, slug e UUID de transação. Validações conservadoras podem recusar formatos legítimos até a homologação; não afrouxar sem evidência.
- Vínculo efetivo entre API Key, recebedor, `order_nsu`, slug e transação na consulta. Resposta incompatível com o identificador esperado precisa falhar, inclusive com mesmo valor e transações de outra cobrança.
- `single_payment`, `valid_until` e métodos precisam ser verificados na conta da Ligado. Uma opção aceita em JSON não prova que o provedor a aplicou.

## Condições que impedem a habilitação

1. Confirmar a opção de Checkout Integrado e a contratação aplicável à conta. Credencial permanece em cofre/arquivo privado do servidor; nunca pelo chat nem no app do cliente.
2. Obter ambiente oficial de homologação ou procedimento autorizado. Não foi confirmado sandbox público isolado para este produto; não confundir InfinitePay/CloudWalk com serviços de nome semelhante em outros domínios.
3. Confirmar autenticação e assinatura das notificações, defesa contra replay e definição dos eventos. Nenhuma assinatura foi inventada e nenhum webhook foi aberto neste projeto.
4. Documentar a recuperação após timeout de criação ou perda de resposta, sem recriar cobrança. `order_nsu` sozinho não foi comprovado como idempotência.
5. Confirmar consulta por referência independente do retorno do comprador, recuperação de notificações perdidas e distinção entre pago, liquidado, cancelado e estornado.
6. Confirmar devolução de Pix: API disponível ou processo operacional formal, autorização, consulta e tratamento de falhas. Não foi implementado endpoint de devolução por suposição.
7. Integrar ao registro financeiro durável com identificador do provedor, exclusividade global da transação e eventos/outbox na mesma transação. `PAID_PIX` hoje é uma observação do adaptador, não uma alteração de estado financeiro persistido.
8. Homologar limites, expiração, valores, conta recebedora, isolamento e falhas antes de mudar a configuração de produção ou integrar a tela de aprovação.

## Perguntas prontas para o suporte

“Vamos integrar o Checkout Integrado da InfinitePay na aplicação própria da Ligado. Precisamos confirmar: sandbox ou procedimento oficial de homologação; autenticação/assinatura dos webhooks e reenvios; idempotência e recuperação de criação por order_nsu após timeout; consulta sem depender do retorno do comprador; formato de resposta e vínculo entre chave, conta e transação; significado de amount e paid_amount no Pix; devolução por API; possibilidade de checkout exclusivamente Pix. Podem fornecer a documentação técnica e as condições aplicáveis à nossa conta?”

## Fontes oficiais consultadas

- [Central de ajuda atual](https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay)
- [Documentação de checkout](https://www.infinitepay.io/checkout-documentacao)
- [Checkout e Pix grátis](https://www.infinitepay.io/checkout)
- [Integrações oficiais e contato técnico](https://www.infinitepay.io/desenvolvedores)
