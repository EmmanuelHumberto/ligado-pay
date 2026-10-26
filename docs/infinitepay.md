# Conector InfinitePay em validação de contrato

Prioridade autorizada pelo usuário: InfinitePay para receber Pix sem a tarifa informada para Mercado Pago. Em 26/10/2026, o usuário confirmou Checkout Integrado habilitado e chave criada; informou que não existe seleção de sandbox na conta. O usuário forneceu a chave em arquivo local temporário; o helper a cifrou com DPAPI e removeu-se a entrada após confirmar a gravação. O runtime confirmou leitura protegida e sintaxe sem exibir a chave, sem enviar seu valor ao chat e sem chamadas ao provedor. Isso não comprova autenticação real. Não exigir que o usuário obtenha um sandbox inexistente ou resposta do suporte para continuar o desenvolvimento.

## Integração local 0.2

O adaptador agora está ligado ao registro financeiro e à API por configuração local explícita. O modo padrão continua simulado. A conta InfinitePay é identificada como `production`, mesmo em desenvolvimento local; nunca é rotulada falsamente como sandbox. `liveCreationEnabled=false` bloqueia a criação antes de gravar intenção ou chamar o provedor.

`POST /v1/payments` reserva uma intenção no mesmo banco e ledger usados pelo gateway; o link fica persistido. `GET /v1/payments/:id` consulta o registro autorizado. `POST /v1/payments/:id/check` exige `payments:read` e a nova permissão `payments:check`, consulta o provedor e aplica a observação autenticada em transação.

`PAID_PIX` só é persistido junto com um registro único da transação e um evento/outbox. A mesma transação não quita duas cobranças, inclusive entre aplicações distintas. `REVIEW_REQUIRED` preserva divergências, incluindo pagamento em cartão, sem afirmar quitação Pix ou autorizar recobrança; não pode ser convertido automaticamente em pago por outra observação. A resolução manual ainda não foi implementada. Consulta pendente não rebaixa um pagamento já confirmado. Não há observação automática de estornos nesta etapa: o estado indica a confirmação registrada, não liquidação final ou monitoramento completo do ciclo financeiro.

No Windows, o comando `scripts/guardar-chave-infinitepay.ps1` recebe a chave com entrada oculta e grava DPAPI do usuário atual fora do repositório, com ACL restrita. A API carrega a chave apenas na memória. Os testes automatizados usam chave sintética; a leitura local da chave real foi confirmada separadamente sem saída de seu valor. DPAPI não protege contra processo malicioso executado com a mesma identidade. Preserve a cópia de recuperação no gerenciador de senhas.

Se a colagem na entrada oculta falhar, copie somente o valor da chave e execute `& .\scripts\guardar-chave-infinitepay.ps1 -DaAreaDeTransferencia`. Essa opção lê o texto localmente, sem imprimi-lo e sem chamada ao provedor. Não altera a área de transferência; após guardar a chave, substitua seu conteúdo. Entrada recusada mostra somente tamanho e contagens de espaços, controles e caracteres fora de ASCII, após remover espaços externos. As contagens podem se sobrepor e não comprovam autenticidade da chave. `-ValidarApenas` verifica a sintaxe sem gravar arquivo; não valida a credencial junto à InfinitePay.

## Implementado

Recuperação local do consumidor: `GET /v1/payment-references/:receiverId/:externalReference` exige leitura autorizada e retorna somente registro existente no gateway, mesmo com criação desligada. Não chama `/links` ou `/payment_check`. Serve para recuperar o ID/link que o consumidor perdeu; `PROCESSING`, `UNCERTAIN` ou referência ausente não autorizam criar novamente. Incerteza no próprio provedor ainda exige conciliação. Os endpoints preparados de retorno do SystemOS usam sessão/DTO e reconsulta; UI e URL de retorno no provedor não foram alteradas.

Alternativa de entrada por arquivo: `& .\scripts\guardar-chave-infinitepay.ps1 -DoArquivo "$env:LOCALAPPDATA\LigadoTattoo\LigadoPay\infinitepay-entrada.txt"`. O arquivo temporário contém apenas a chave, sem aspas ou nome de variável, e deve ficar fora do repositório com ACL restrita. O comando valida e cifra sem imprimir seu conteúdo; não remove a origem. Após confirmar a gravação DPAPI, remova o arquivo temporário. Não cole texto diretamente no arquivo `.dpapi`.

- Porta `CheckoutConnector` independente de OS, pedidos comerciais e dados de cartão.
- Adaptador HTTP para os endpoints oficiais `/links` e `/payment_check`, com origem fixa `https://api.checkout.infinitepay.io`, chave apenas no header, rejeição de redirects, timeout e limite de 32 KiB para respostas JSON.
- Recebedor/InfiniteTag, limite e endereço de retorno são configuração de servidor. A entrada não escolhe conta, destino HTTP, itens comerciais ou credenciais.
- Solicitação com referência UUID da intenção já reservada, centavos inteiros, descrição genérica, uso único e expiração limitada a 24 horas por política interna. Nenhum nome, CPF, e-mail ou endereço é enviado nesta etapa.
- Validação conservadora do link de retorno: HTTPS, host exato, caminho correspondente ao recebedor, sem usuário/senha, query ou fragmento. Não se segue nenhum link de recibo.
- Consulta autenticada usando referência e identificadores da transação. Campos recebidos por redirect/webhook servem somente como pistas; não confirmam pagamento.
- Observação `PAID_PIX` somente para resposta autenticada `success=true`, `paid=true`, método Pix, valores exatos em centavos e uma parcela. Divergência vira `REVIEW_REQUIRED`; não é tratada como pagamento negado nem como autorização para cobrar novamente.
- Falha de criação resulta em `CREATE_RESULT_UNCERTAIN`. O adaptador não repete a chamada e não inventa que a referência externa seja uma chave de idempotência nativa do provedor.

Os testes usam respostas sintéticas e transporte injetado, inclusive através da API e PostgreSQL reais. A composição `src/main.ts` também foi iniciada com chave sintética cifrada, usuário restrito e bloqueio de qualquer chamada externa: criação desabilitada e zero requests ao provedor confirmados. Em 26/10/2026, a configuração privada da conta informada pelo usuário foi preparada com referência à chave DPAPI e criação real desabilitada. Após autorização específica, o comando de validação criou um único link real de R$ 1,00: uma chamada, HTTP 200, estado local PENDING e URL aceita pela validação de conta e host. Após o usuário concluir o checkout e solicitar verificação, uma consulta autenticada confirmou Pix de R$ 1,00 e o gateway persistiu PAID_PIX. Nenhum webhook foi cadastrado. A criação geral permanece desabilitada.

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

### Primeiro teste real concluído — não repetir

O procedimento abaixo registra como o teste foi preparado. Ele já foi executado, pago e confirmado, conforme a conclusão ao final desta seção e `docs/retomada.md`. Não executar novamente nem apagar o marcador para retomar o projeto.

`node scripts/infinitepay-live-validation.mjs` mostra somente o plano, sem ler a chave, abrir o banco ou chamar o provedor. O plano fixa um link de R$ 1,00 para `emmanuel-humberto`, retorno ao portal, solicitação de validade de uma hora e uso único, sem webhook, notificação a clientes ou pagamento automático. Pix e cartão continuam disponíveis. Validade e uso único são opções solicitadas ao provedor, ainda não comprovadas em operação real.

Somente após autorização explícita dessa operação: `node scripts/infinitepay-live-validation.mjs --execute --confirm=CREATE_ONE_BRL_1_LINK`. O PostgreSQL local precisa estar iniciado e migrado. O comando usa o papel runtime restrito e os mesmos serviço, adaptador e registro financeiro da API, sem abrir uma porta HTTP. O limite de criação é reduzido a 100 centavos nesse processo; a configuração persistente permanece com criação desligada.

Antes de permitir envio, cria exclusivamente `.local/infinitepay-validation-attempt.jsonl` e sincroniza a reserva em disco. O registro financeiro também reserva a intenção antes da chamada. Há no máximo uma chamada ao endpoint de criação, sem repetição automática. O marcador bloqueia nova execução tanto em sucesso quanto em falha incerta ou interrupção; não apagá-lo para tentar novamente. Após resposta, o resultado validado é acrescentado ao arquivo privado. Se houver falha, conciliar a referência registrada com o banco e a conta InfinitePay antes de qualquer nova operação. Não há desfazimento automático do link pelo comando.

Em 26/10/2026 foram aprovados 27 testes locais, incluindo concorrência, bloqueio de repetição após falha incerta e recusa de mudança da conta/valor previsto. A prévia real de configuração foi executada com zero chamadas externas. Em seguida, o usuário autorizou criar e receber o link de R$ 1,00. A execução fez uma chamada, recebeu HTTP 200 e persistiu PENDING com identificador `65511ae7-3957-4afd-8663-0d13a934d8db`. O navegador confirmou resumo de R$ 1,00 e a conta esperada, mas exige nome, telefone e e-mail antes dos meios de pagamento. Não se enviaram dados de pagador, não se obteve código Pix e não se efetuou pagamento. O link foi entregue ao usuário para concluir essa etapa. A validade solicitada e a prevenção de segundo pagamento pelo provedor ainda não foram comprovadas; o retorno aceito não constitui homologação completa, nem prova isolada de que a chave rejeita credenciais inválidas.

Depois que o usuário concluiu o checkout, a página exibiu sucesso e o retorno forneceu identificadores de transação. Esses parâmetros foram usados somente como pistas: o mesmo CheckoutService consultou `/payment_check` com a chave protegida, conferiu referência, método Pix, moeda quando presente, parcela única e ambos os valores de 100 centavos, persistindo PAID_PIX com settlement único e evento/outbox na transação local. A verificação fez uma consulta externa e nenhuma criação, mantendo a criação desabilitada. Isso confirma o teste específico, sem comprovar liquidação final, estornos ou integração automática com SystemOS/portal/app. Ver `evidencias/infinitepay-primeiro-pix.json`.

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


## Operação privada atual

A orientação vigente de recuperação, alertas e devoluções está em [Operação privada do Pix](operacao-pix.md). Devoluções/cancelamentos financeiros são feitos exclusivamente na conta InfinitePay. Solicitações e avisos internos permanecem pendentes e não comprovam nem lançam uma devolução. As seções de preparação acima são históricas; a integração privada por webhook e os testes Pix reais posteriores estão registrados em docs/retomada.md.
