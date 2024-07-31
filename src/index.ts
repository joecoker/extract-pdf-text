import { Builder, WebDriver } from 'selenium-webdriver';
import CDP from 'chrome-remote-interface';
import { Options } from 'selenium-webdriver/chrome';
import fs from 'fs/promises';
import path from 'path';
import { pdfToText } from 'pdf-ts';
import { promisify } from 'util';

const logger = console;

const sleep = promisify(setTimeout);

const MAX_FILE_CHECK_ATTEMPTS = 6;
const FILE_CHECK_INTERVAL = 10000; // 10 seconds

async function findPdfFile(downloadPath: string): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_FILE_CHECK_ATTEMPTS; attempt++) {
    const fileList = await fs.readdir(downloadPath);

    logger.info(
      `Checking for PDF file... (Attempt ${attempt}/${MAX_FILE_CHECK_ATTEMPTS}) - ${downloadPath}`,
      {
        fileList,
      }
    );

    const pdfFileName = fileList.find((file: string) => file.endsWith('.pdf'));
    if (pdfFileName) {
      return pdfFileName;
    }

    await sleep(FILE_CHECK_INTERVAL);
  }

  return null;
}

export const getBillText = async (pdfUrl: string, downloadPath: string) => {
  let client;
  let driver: WebDriver;

  try {
    const options = new Options();
    options.addArguments('--headless');
    options.addArguments(
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0'
    );
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--remote-debugging-port=9222');
    options.addArguments('--disable-gpu');
    options.addArguments('--disable-software-rasterizer');
    options.setUserPreferences({
      'plugins.always_open_pdf_externally': true,
      'download.default_directory': downloadPath,
    });

    logger.info(`Getting bill text: ${pdfUrl}`);

    driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();

    client = await CDP();
    const { Page, Network } = client;

    await Promise.all([Page.enable(), Network.enable()]);

    await Page.setDownloadBehavior({
      behavior: 'allow',
      downloadPath: downloadPath,
    });

    logger.info(`Navigating to PDF URL: ${pdfUrl}`);

    const response = await Page.navigate({ url: pdfUrl }).catch((error) => {
      logger.error('Navigation failed:', { error });
      throw error;
    });

    logger.info('Navigation response:', { response });

    logger.info('Waiting for the PDF to load...');

    logger.info('Waiting for the PDF file to be downloaded...');
    await sleep(10000);

    const pdfFileName = await findPdfFile(downloadPath);
    if (!pdfFileName) {
      throw new Error('Failed to download PDF');
    }

    logger.info(`PDF file successfully downloaded: ${pdfFileName}`);

    const pdfFilePath = path.join(downloadPath, pdfFileName);
    const pdfContent = await fs.readFile(pdfFilePath);

    let text = await pdfToText(pdfContent);
    text = text.replace(/\n(?!\n)/g, ' ');

    logger.info(`PDF text length: ${text.length}`);

    await fs.unlink(pdfFilePath);
    logger.info('PDF file deleted successfully.');

    return text;
  } catch (error) {
    logger.error('Error getting bill text:', { pdfUrl, error });
    return null;
  } finally {
    logger.info('Quitting driver...');
    //@ts-ignore
    await driver.quit();
  }
};

getBillText(
  'https://bills.parliament.uk/publications/56005/documents/4984',
  __dirname
);