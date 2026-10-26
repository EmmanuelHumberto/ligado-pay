# Retomada — Ligado Pay

Atualizado em 26/10/2026. Registro para continuar o trabalho sem repetir operações financeiras já realizadas.

## Projeto e decisões

- Diretório: `C:\Users\User\Documents\Projetos\ecosistema\ligado-pay`.
- Remoto: `https://github.com/EmmanuelHumberto/ligado-pay.git`. Nenhum push foi realizado nesta sequência.
- Último commit de implementação: `3c4014b` — proteção da chave e primeiro Pix real. Commit anterior: `e51e8ff` — credencial opaca sem prefixo presumido.
- O gateway é exclusivamente uma API. Não incorporar frontend, CRM, máquinas, OS, orçamento, estoque ou regras comerciais.
- Primeiro consumidor previsto: backend do SystemOS; portal e app passam por ele. Loja futura e outros projetos usarão a mesma API, com autorização própria.
- Banco próprio, sem acesso direto aos bancos consumidores. PostgreSQL local já exclusivo, com papel runtime restrito e identidade separada de migração. Instância separada também foi recomendada para produção; hospedagem e implantação ainda não definidas. Separação não exige necessariamente outro computador físico.
- Prioridade: InfinitePay. Não implementar cobrança fictícia diretamente no Banco Central nem substituir pelo Mercado Pago sem decisão do usuário.

## Primeiro teste real: concluído e pago

O usuário autorizou especificamente criar um único link de R$ 1,00 e depois pediu a verificação do pagamento.

- Conta pública/InfiniteTag informada: `emmanuel-humberto`.
- Cobrança local: `65511ae7-3957-4afd-8663-0d13a934d8db`.
- Criação: uma chamada a `/links`, HTTP 200, URL aceita pelo adaptador e estado inicialmente PENDING.
- O usuário concluiu o checkout. O agente não preencheu dados de pagador nem efetuou o pagamento.
- A tela mostrou sucesso. O botão Continuar forneceu parâmetros de retorno; esses parâmetros foram usados somente como pistas.
- Uma consulta autenticada a `/payment_check`, pelo CheckoutService e adaptador existentes, confirmou Pix, parcela única e ambos os valores de 100 centavos. O gateway persistiu **PAID_PIX**, com settlement e evento/outbox na transação local.
- Evidência sem chave ou dados do pagador: `evidencias/infinitepay-primeiro-pix.json`.
- Isso confirma esta cobrança. Não comprova liquidação final, devolução, assinatura de webhook, recuperação de notificações perdidas ou homologação completa.

**Não recriar nem pagar novamente essa cobrança.** Não remover `.local/infinitepay-validation-attempt.jsonl` para repetir o teste. O arquivo contém a reserva da tentativa e seu resultado inicial; o estado financeiro atual confirmado está no banco, não no resultado PENDING original do marcador.

## Credencial e configuração privadas

- Chave real guardada com DPAPI do usuário Windows e ACL restrita, em `%LOCALAPPDATA%\LigadoTattoo\LigadoPay\infinitepay.dpapi`. Não imprimir, copiar para o Git, passar por argumento ou enviar ao chat.
- O usuário preencheu `infinitepay-entrada.txt` na raiz do projeto. O helper cifrou a chave e o arquivo preenchido foi removido após confirmar a gravação. A raiz tem regra explícita no `.gitignore` para impedir versionamento desse nome.
- O helper suporta entrada oculta, `-DaAreaDeTransferencia` e `-DoArquivo`. Rejeições mostram somente contagens; não presumir prefixo `inchk_`.
- A leitura protegida pela API foi conferida. O teste real funcionou com a credencial configurada; isso não demonstra, por si só, rejeição de uma chave inválida pelo provedor.
- Configuração privada preparada: `.local/infinitepay.runtime.json`. Retorno: `https://os.ligadotattoo.com.br/portal`.
- **Criação geral permanece `liveCreationEnabled=false`.** O comando controlado habilitou somente seu processo para a única operação autorizada, limitada a 100 centavos. Não alterou esse arquivo para habilitar criação geral.
- `.local/` contém configurações e tokens privados. Não exibir seu conteúdo em comandos, logs ou evidências.

## Estado técnico e verificações

- TypeScript/Fastify, PostgreSQL próprio, autenticação de serviço, autorização por aplicação/recebedor, intenção durável, idempotência, referência única e eventos/outbox transacionais implementados.
- Adaptador com destino oficial fixo, timeout, bloqueio de redirects e limite de resposta. Erro de criação pode significar resultado incerto; nunca repetir automaticamente.
- Cartão ou divergência de valor resulta em REVIEW_REQUIRED. Resolução manual ainda não implementada. A mesma transação não pode quitar duas cobranças.
- `npm test`: **27 testes passaram** na última execução. Incluem formato/armazenamento da chave, isolamento HTTP, contrato sintético, plano de validação, concorrência e bloqueio de repetição após erro incerto.
- `npm run infinitepay:verify`: passou com chave sintética, banco real local, criação bloqueada e zero chamadas externas. Não confundir essa verificação com o teste real acima.
- O comando `scripts/infinitepay-live-validation.mjs`, sem argumentos, mostra somente a prévia. A execução real exige flags explícitas e marcador exclusivo sincronizado em disco antes do envio. Não executar novamente para retomar o projeto.
- O PostgreSQL local foi **parado** ao terminar. Nenhuma API ficou rodando por estes comandos. Não remover volumes: contêm o registro financeiro do Pix confirmado.
- Não houve publicação, push, mudança dos pagamentos Mercado Pago existentes ou cadastro de webhook.

## Limites observados no checkout

- O produto usado fornece link de checkout, não QR/copia e cola diretamente pela API implementada.
- Pix e cartão permanecem disponíveis; não apresentar como exclusivamente Pix.
- O checkout exigiu nome, telefone e e-mail antes dos meios de pagamento. O usuário preencheu a etapa; não coletar esses dados por ferramentas para repetir o fluxo.
- O retorno hoje aponta para `/portal`, sem tratamento dedicado integrado ao Ligado Pay. Retornar ao portal não atualiza automaticamente uma OS.
- Validade de uma hora e uso único foram solicitados ao provedor, mas a aplicação efetiva dessas opções ainda não foi comprovada.
- Documentação atual: https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay . Distinguir essa orientação da documentação antiga que usa handle sem API Key.

## Próximos passos

1. Ler `AGENTS.md`, este arquivo, `docs/infinitepay.md`, arquitetura e modelo de ameaças. Conferir Git e estado do banco sem imprimir segredos.
2. Preparar a integração SystemOS → API do Ligado Pay, inicialmente desligada e testada com transporte simulado. Ler as instruções do repositório SystemOS antes de modificá-lo. O gateway não acessa sua base nem decide aprovação/saldo de orçamento.
3. No SystemOS, validar sessão, titularidade, orçamento aprovado, versão, valor/saldo calculados no servidor e concorrência entre meios de pagamento antes de solicitar cobrança. Preservar pagamentos existentes.
4. Implementar retorno dedicado e consulta autenticada para vincular cobrança ao consumidor correto. Portal/app recebem somente dados necessários; nunca a chave InfinitePay ou token de serviço. Redirect ou comprovante não confirmam pagamento.
5. Completar recuperação de resultados incertos, conciliação e entrega autenticada dos eventos/outbox, com deduplicação. Não abrir webhook confiando apenas no corpo; autenticidade/replay ainda precisam ser comprovados conforme contrato do provedor.
6. Definir devolução, tratamento de revisão manual e ciclo de cancelamento/estorno. Não inventar endpoints nem prometer garantias não demonstradas.
7. Antes de produção: limites financeiros agregados, rede e identidades, proteção do host, observabilidade, cofre/rotação, backup cifrado externo e restauração, além de revisão de segurança.

O usuário autoriza prosseguir no desenvolvimento. Uma **nova operação financeira real** precisa ter seus efeitos concretos apresentados e autorizados conforme `AGENTS.md`; o teste de R$ 1,00 já concluído não autoriza cobranças adicionais. Não insistir em obter sandbox: o usuário informou que essa seleção não existe na conta. Desenvolver com documentação e testes locais, registrando limites reais.
