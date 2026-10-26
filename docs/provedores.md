# Provedores e critérios de habilitação

Pesquisa preliminar em 25/10/2026. Documentação encontrada não comprova contratação, elegibilidade da conta, segurança de uma implantação nem aprovação para produção. Há adaptador InfinitePay com testes sintéticos, ainda sem conexão real ou habilitação na API; ver [limites e homologação](infinitepay.md).

## Pix

Escolha inicial do usuário: receber no Nu e priorizar API Pix no padrão do BC. Após a pesquisa de API e a discussão de tarifas, o usuário autorizou avançar na avaliação do checkout InfinitePay. Não iniciar integração pelo Mercado Pago em substituição a essa decisão. Na consulta de 25/10/2026, as páginas oficiais do Nu confirmaram cobrança Pix pelo aplicativo/plataforma, mas não foi localizada documentação pública suficiente de API de cobrança com consulta, webhook e devolução contratável pela Ligado. Isso não prova inexistência de oferta restrita; confirmar com o Nu antes de implementar um adaptador.

Solicitação ao atendimento: “Minha conta oferece API Pix oficial para integração própria, com cobrança dinâmica, txid, consulta de Pix recebidos, webhook e devolução? Se oferece, preciso da documentação técnica, requisitos de contratação, autenticação/certificados e ambiente de homologação.” Não solicitar nem compartilhar senha bancária. Sem acesso oficial confirmado, a integração automática com o Nu permanece bloqueada; não substituir confirmação financeira por e-mail, comprovante ou scraping.

Banco Central define o arranjo e o padrão API Pix. A Ligado contrata a API de uma instituição participante para gerar cobranças e confirmar recebimentos. Não oferecer “Banco Central” como provedor de cobrança nem assumir que Pix é gratuito por usar seu padrão.

Fontes: [BC para empresas](https://www.bcb.gov.br/en/financialstability/pixbusinesses), [contratação por PJ e MEI](https://www.bcb.gov.br/detalhenoticia/21252/noticia).

## Pesquisa inicial

| Instituição | Evidência pública | Situação no Ligado Pay |
|---|---|---|
| Mercado Pago | Referência oficial de cobrança, consulta, cancelamento e estorno; integração já existente no SystemOS | Alternativa futura; usuário priorizou receber Pix no Nu. Não iniciar como substituição sem nova decisão |
| Efí | API Pix, autenticação/certificados, escopos e webhook com mTLS documentados | Candidata a Pix por PSP; confirmar contratação e demonstrar mTLS na infraestrutura escolhida |
| Banco do Brasil | API Pix para QR e verificação de liquidação documentada | Candidato; confirmar elegibilidade, contrato e requisitos completos antes de construir adaptador |
| InfinitePay | Checkout, API Key, notificações e consulta payment_check documentados; Pix grátis anunciado no checkout | Prioridade atual autorizada; adaptador testado com respostas sintéticas, sem chamadas externas; conta, recuperação, devolução e contrato real pendentes |
| Nubank | Cobrança por aplicativo Nu Empresas documentada | API de cobrança automatizada adequada não confirmada nesta pesquisa; não integrar por scraping, e-mail, comprovante ou biblioteca não oficial |

## Condições de entrada

- Documentação oficial identificável, versionamento, termos compatíveis e acesso contratável pela conta da Ligado.
- Criar cobrança, consultar estado no servidor e correlacionar identificador, recebedor e valor; expiração e cancelamento com semântica definida.
- Devolução/estorno e tratamento de resultados incertos. Para cartão, capacidades de contestação e fluxo de tokenização/checkout compatíveis.
- Autenticação das chamadas e estratégia verificável de autenticidade das notificações; notificações não confiáveis não bastam para liberar pagamento.
- Idempotência nativa ou estratégia comprovada contra duplicidade, incluindo falha de rede depois da criação. Consulta de recuperação e conciliação obrigatórias.
- Ambiente de teste ou processo oficial de homologação que cubra as falhas necessárias; suporte e limites operacionais conhecidos.
- Segregação de teste/produção, rotação/revogação de credenciais, permissões mínimas e validação da conta recebedora.
- Registrar capacidades individualmente: Pix em um provedor não implica suporte a cartão, estorno parcial ou todos os métodos. API pública e UI só apresentam o que estiver homologado e habilitado.

Não incorporar um provedor com lacunas críticas só para aumentar opções. Custos, disponibilidade comercial e qualidade operacional ainda precisam ser comparados antes da escolha do segundo provedor.

## Fontes oficiais

- [Mercado Pago API](https://www.mercadopago.com.br/developers/en/reference)
- [Efí credenciais e certificados](https://dev.efipay.com.br/docs/api-pix/credenciais/)
- [Efí webhooks](https://dev.efipay.com.br/en/docs/api-pix/webhooks/)
- [Banco do Brasil API Pix](https://www.bb.com.br/site/developers/api-pix/)
- [InfinitePay checkout](https://www.infinitepay.io/checkout-documentacao)
- [Nu Empresas cobrança](https://nubank.com.br/empresas/solucoes-para-cobranca)
