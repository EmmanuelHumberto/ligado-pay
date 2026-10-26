# Conector InfinitePay em validação de contrato

Prioridade autorizada pelo usuário: InfinitePay para receber Pix sem a tarifa informada para Mercado Pago. Em 26/10/2026, o usuário confirmou Checkout Integrado habilitado e chave criada; informou que não existe seleção de sandbox na conta. A chave não foi enviada ao chat nem coletada pelo agente. Não exigir que o usuário obtenha um sandbox inexistente ou resposta do suporte para continuar o desenvolvimento.

## Integração local 0.2

O adaptador agora está ligado ao registro financeiro e à API por configuração local explícita. O modo padrão continua simulado. A conta InfinitePay é identificada como `production`, mesmo em desenvolvimento local; nunca é rotulada falsamente como sandbox. `liveCreationEnabled=false` bloqueia a criação antes de gravar intenção ou chamar o provedor.

`POST /v1/payments` reserva uma intenção no mesmo banco e ledger usados pelo gateway; o link fica persistido. `GET /v1/payments/:id` consulta o registro autorizado. `POST /v1/payments/:id/check` exige `payments:read` e a nova permissão `payments:check`, consulta o provedor e aplica a observação autenticada em transação.

`PAID_PIX` só é persistido junto com um registro único da transação e um evento/outbox. A mesma transação não quita duas cobranças, inclusive entre aplicações distintas. `REVIEW_REQUIRED` preserva divergências, incluindo pagamento em cartão, sem afirmar quitação Pix ou autorizar recobrança; não pode ser convertido automaticamente em pago por outra observação. A resolução manual ainda não foi implementada. Consulta pendente não rebaixa um pagamento já confirmado. Não há observação automática de estornos nesta etapa: o estado indica a confirmação registrada, não liquidação final ou monitoramento completo do ciclo financeiro.

No Windows, o comando `scripts/guardar-chave-infinitepay.ps1` recebe a chave com entrada oculta e grava DPAPI do usuário atual fora do repositório, com ACL restrita. A API carrega a chave apenas na memória. A proteção foi testada com chave sintética; a chave real não foi lida. DPAPI não protege contra processo malicioso executado com a mesma identidade. Preserve a cópia de recuperação no gerenciador de senhas.

## Implementado

- Porta `CheckoutConnector` independente de OS, pedidos comerciais e dados de cartão.
- Adaptador HTTP para os endpoints oficiais `/links` e `/payment_check`, com origem fixa `https://api.checkout.infinitepay.io`, chave apenas no header, rejeição de redirects, timeout e limite de 32 KiB para respostas JSON.
- Recebedor/InfiniteTag, limite e endereço de retorno são configuração de servidor. A entrada não escolhe conta, destino HTTP, itens comerciais ou credenciais.
- Solicitação com referência UUID da intenção já reservada, centavos inteiros, descrição genérica, uso único e expiração limitada a 24 horas por política interna. Nenhum nome, CPF, e-mail ou endereço é enviado nesta etapa.
- Validação conservadora do link de retorno: HTTPS, host exato, caminho correspondente ao recebedor, sem usuário/senha, query ou fragmento. Não se segue nenhum link de recibo.
- Consulta autenticada usando referência e identificadores da transação. Campos recebidos por redirect/webhook servem somente como pistas; não confirmam pagamento.
- Observação `PAID_PIX` somente para resposta autenticada `success=true`, `paid=true`, método Pix, valores exatos em centavos e uma parcela. Divergência vira `REVIEW_REQUIRED`; não é tratada como pagamento negado nem como autorização para cobrar novamente.
- Falha de criação resulta em `CREATE_RESULT_UNCERTAIN`. O adaptador não repete a chamada e não inventa que a referência externa seja uma chave de idempotência nativa do provedor.

Os testes usam respostas sintéticas e transporte injetado, inclusive através da API e PostgreSQL reais. A composição `src/main.ts` também foi iniciada com chave sintética cifrada, usuário restrito e bloqueio de qualquer chamada externa: criação desabilitada e zero requests ao provedor confirmados. O runtime não foi configurado com conta/chave real. Nenhum link real foi criado, nenhum webhook cadastrado e nenhum pagamento real confirmado.

## Limitações confirmadas na documentação

O produto documentado é checkout hospedado, não uma API de QR Pix direto. A central de ajuda informa que cartão continua disponível. Os resultados do adaptador declaram `exclusivePix=false` e `directQrAvailable=false`; um cartão pago vai para revisão, nunca é apresentado como Pix quitado. Isso impede liberar o produto como exclusivamente Pix nesta etapa.

Existe documentação antiga com InfiniteTag e `webhook_url`; a orientação atual da central inclui API Key, `options` e objeto `webhook`. A chave é exigida pelo nosso adaptador mesmo onde o provedor admite fluxo básico sem ela.

O exemplo público de `payment_check` contém `amount` e `paid_amount` diferentes. Não presumimos que a diferença seja tarifa, juros ou valor líquido. Qualquer diferença vai para revisão até haver definição contratual, especialmente para Pix.

## Hipóteses de contrato ainda não homologadas

- Formato exato da resposta de criação: os normalizadores aceitam candidatos `url`, `checkout_url` ou `link`, recusando campos conflitantes. Esses nomes e o host/caminho do checkout precisam ser confirmados em contrato oficial ou teste autorizado; os fixtures não comprovam a resposta real.
- A API Key é tratada como credencial opaca: não exigir prefixo de exemplo. A política compartilhada aceita ASCII visível até 2048 caracteres, remove espaços externos de cópia e rejeita vazio, espaços internos e caracteres de controle. Isso valida segurança do header, não autenticidade da chave. InfiniteTag, slug e UUID ainda exigem confirmação de formato na integração real.
- Vínculo efetivo entre API Key, recebedor, `order_nsu`, slug e transação na consulta. Resposta incompatível com o identificador esperado precisa falhar, inclusive com mesmo valor e transações de outra cobrança.
- `single_payment`, `valid_until` e métodos precisam ser verificados na conta da Ligado. Uma opção aceita em JSON não prova que o provedor a aplicou.

## Validações restantes e operação real

1. Guardar a chave criada em armazenamento protegido no computador do servidor. Nunca pelo chat ou app do cliente. Preparar configuração inicialmente com criação real desabilitada.
2. Não há seleção de sandbox na conta informada. Continuar testes locais e preparar teste controlado no ambiente real, descrevendo antecipadamente a operação e seus possíveis efeitos para autorização do usuário. Não confundir InfinitePay/CloudWalk com serviços de nome semelhante em outros domínios.
3. Confirmar autenticação e assinatura das notificações, defesa contra replay e definição dos eventos. Nenhuma assinatura foi inventada e nenhum webhook foi aberto neste projeto.
4. Documentar a recuperação após timeout de criação ou perda de resposta, sem recriar cobrança. `order_nsu` sozinho não foi comprovado como idempotência.
5. Confirmar consulta por referência independente do retorno do comprador, recuperação de notificações perdidas e distinção entre pago, liquidado, cancelado e estornado.
6. Confirmar devolução de Pix: API disponível ou processo operacional formal, autorização, consulta e tratamento de falhas. Não foi implementado endpoint de devolução por suposição.
7. Registro financeiro durável, exclusividade da transação e evento/outbox já integrados e testados localmente. Validar esse contrato com resposta real antes de liberação; a comprovação local não é homologação no provedor.
8. Homologar limites, expiração, valores, conta recebedora, isolamento e falhas antes de mudar a configuração de produção ou integrar a tela de aprovação.

## Perguntas prontas para o suporte

“Vamos integrar o Checkout Integrado da InfinitePay na aplicação própria da Ligado. Precisamos confirmar: sandbox ou procedimento oficial de homologação; autenticação/assinatura dos webhooks e reenvios; idempotência e recuperação de criação por order_nsu após timeout; consulta sem depender do retorno do comprador; formato de resposta e vínculo entre chave, conta e transação; significado de amount e paid_amount no Pix; devolução por API; possibilidade de checkout exclusivamente Pix. Podem fornecer a documentação técnica e as condições aplicáveis à nossa conta?”

## Fontes oficiais consultadas

- [Central de ajuda atual](https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay)
- [Documentação de checkout](https://www.infinitepay.io/checkout-documentacao)
- [Checkout e Pix grátis](https://www.infinitepay.io/checkout)
- [Integrações oficiais e contato técnico](https://www.infinitepay.io/desenvolvedores)
